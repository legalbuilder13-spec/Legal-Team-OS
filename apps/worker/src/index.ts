import { eq, sql } from 'drizzle-orm';
import cron from 'node-cron';
import { jobs, getDb, type Job } from '@legal/db';
import { env } from './env.js';
import { handleTriageJob } from './handlers/triage.js';
import { handleSlackNotifyJob } from './handlers/slack-notify.js';
import { handleContextFetchJob } from './handlers/context-fetch.js';
import { handleGenerateEmbeddingJob } from './handlers/generate-embedding.js';
import { handleEnrichCounterpartyMemoryJob } from './handlers/enrich-counterparty-memory.js';
import { runSlaCheck } from './handlers/sla-check.js';
import { runDailyDigest } from './handlers/daily-digest.js';
import { runPortfolioAnalysis } from './handlers/analyze-portfolio.js';

const db = getDb();
const MAX_ATTEMPTS = 5;

async function claimNextJob(): Promise<Job | null> {
  const result = await db.execute(sql`
    UPDATE jobs
    SET status = 'running', started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `);
  const id = (result[0] as { id?: string } | undefined)?.id;
  if (!id) return null;
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
  return job ?? null;
}

async function dispatch(job: Job) {
  switch (job.kind) {
    case 'triage':
      await handleTriageJob(db, job);
      break;
    case 'slack_notify':
      await handleSlackNotifyJob(db, job);
      break;
    case 'context_fetch':
      await handleContextFetchJob(db, job);
      break;
    case 'generate_embedding':
      await handleGenerateEmbeddingJob(db, job);
      break;
    case 'enrich_counterparty_memory':
      await handleEnrichCounterpartyMemoryJob(db, job);
      break;
    case 'analyze_portfolio':
      await runPortfolioAnalysis(db);
      break;
    default:
      throw new Error(`unknown job kind: ${job.kind}`);
  }
}

async function pollOnce() {
  const job = await claimNextJob();
  if (!job) return false;

  try {
    await dispatch(job);
    await db
      .update(jobs)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(jobs.id, job.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`job ${job.id} (${job.kind}) failed (attempt ${job.attempts}/${MAX_ATTEMPTS}):`, message);
    const failed = job.attempts >= MAX_ATTEMPTS;
    await db
      .update(jobs)
      .set({
        status: failed ? 'failed' : 'pending',
        lastError: message,
        runAt: failed
          ? job.runAt
          : new Date(Date.now() + Math.pow(2, job.attempts - 1) * 1000),
      })
      .where(eq(jobs.id, job.id));
  }
  return true;
}

async function pollLoop() {
  while (true) {
    try {
      const worked = await pollOnce();
      if (!worked) {
        await new Promise((r) => setTimeout(r, env.POLL_INTERVAL_MS));
      }
    } catch (err) {
      console.error('poll loop error:', err);
      await new Promise((r) => setTimeout(r, env.POLL_INTERVAL_MS));
    }
  }
}

cron.schedule('0 * * * *', async () => {
  try {
    const breached = await runSlaCheck(db);
    if (breached > 0) console.log(`SLA check: ${breached} matters breached`);
  } catch (err) {
    console.error('sla check failed:', err);
  }
});

cron.schedule(
  env.DIGEST_CRON,
  async () => {
    try {
      const sent = await runDailyDigest(db);
      console.log(`daily digest: ${sent} DMs sent`);
    } catch (err) {
      console.error('daily digest failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

cron.schedule(
  '0 7 * * 1',
  async () => {
    try {
      const generated = await runPortfolioAnalysis(db);
      console.log(`portfolio analysis: ${generated} new insights generated`);
    } catch (err) {
      console.error('portfolio analysis failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

console.log(
  `Worker started — digest cron: '${env.DIGEST_CRON}' in ${env.DIGEST_TIMEZONE}`,
);
pollLoop();
