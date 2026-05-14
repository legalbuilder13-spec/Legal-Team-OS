import { eq, sql } from 'drizzle-orm';
import cron from 'node-cron';
import { jobs, getDb, type Job } from '@legal/db';
import { env } from './env.js';
import { handleTriageJob } from './handlers/triage.js';
import { handleSlackNotifyJob } from './handlers/slack-notify.js';
import { handleContextFetchJob } from './handlers/context-fetch.js';
import { handleContextFetchSalesforceJob } from './handlers/context-fetch-salesforce.js';
import { handleContextFetchSimilarMattersJob } from './handlers/context-fetch-similar-matters.js';
import { handleContextFetchNotionJob } from './handlers/context-fetch-notion.js';
import { handleContextFetchSlackJob } from './handlers/context-fetch-slack.js';
import { handleContextFetchDriveJob } from './handlers/context-fetch-drive.js';
import { handleGenerateEmbeddingJob } from './handlers/generate-embedding.js';
import { handleParseDocumentJob } from './handlers/parse-document.js';
import { handleAnalyzeDocumentClausesJob } from './handlers/analyze-document-clauses.js';
import { handleAnalyzeClauseJob } from './handlers/analyze-clause.js';
import { handleEnrichCounterpartyMemoryJob } from './handlers/enrich-counterparty-memory.js';
import { handleAnalyzeJob } from './handlers/analyze.js';
import { handleRunStatutoryJob } from './handlers/tools/run-statutory.js';
import { handleRunCaseLawJob } from './handlers/tools/run-case-law.js';
import { handleRunDeconstructJob } from './handlers/tools/run-deconstruct.js';
import { handleTakeSnapshotJob } from './handlers/take-snapshot.js';
import { closeSnapshotBrowser } from './integrations/playwright_snapshot.js';
import { runSlaCheck } from './handlers/sla-check.js';
import { runDailyDigest } from './handlers/daily-digest.js';
import { runPortfolioAnalysis } from './handlers/analyze-portfolio.js';
import { runMineRejections } from './handlers/mine-rejections.js';
import {
  enqueueClosedMatterCompaction,
  handleCompactMatterJob,
} from './handlers/compact-matter.js';
import { runPromotePlaybooks } from './handlers/promote-playbooks.js';
import { isPermanentJobError } from './utils.js';

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
    case 'context_fetch_salesforce':
      await handleContextFetchSalesforceJob(db, job);
      break;
    case 'context_fetch_similar_matters':
      await handleContextFetchSimilarMattersJob(db, job);
      break;
    case 'context_fetch_notion':
      await handleContextFetchNotionJob(db, job);
      break;
    case 'context_fetch_slack':
      await handleContextFetchSlackJob(db, job);
      break;
    case 'context_fetch_drive':
      await handleContextFetchDriveJob(db, job);
      break;
    case 'parse_document':
      await handleParseDocumentJob(db, job);
      break;
    case 'analyze_document_clauses':
      await handleAnalyzeDocumentClausesJob(db, job);
      break;
    case 'analyze_clause':
      await handleAnalyzeClauseJob(db, job);
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
    case 'analyze':
      await handleAnalyzeJob(db, job);
      break;
    case 'run_statutory':
      await handleRunStatutoryJob(db, job);
      break;
    case 'run_case_law':
      await handleRunCaseLawJob(db, job);
      break;
    case 'run_deconstruct':
      await handleRunDeconstructJob(db, job);
      break;
    case 'take_snapshot':
      await handleTakeSnapshotJob(db, job);
      break;
    case 'compact_matter':
      await handleCompactMatterJob(db, job);
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
    const permanent = isPermanentJobError(err);
    console.error(
      `job ${job.id} (${job.kind}) failed${permanent ? ' [permanent]' : ''} (attempt ${job.attempts}/${MAX_ATTEMPTS}):`,
      message,
    );
    const failed = permanent || job.attempts >= MAX_ATTEMPTS;
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

// M2 — Daily enqueue compact-matter jobs for newly-closed matters
// without summaries. The compact handler is idempotent on
// source_version_hash, so re-enqueuing a matter that didn't change
// is a no-op LLM-cost-wise. Runs at 06:00 so summaries are ready by
// the time the daily digest fires.
cron.schedule(
  '0 6 * * *',
  async () => {
    try {
      const enqueued = await enqueueClosedMatterCompaction(db);
      if (enqueued > 0) console.log(`compact-matter: enqueued ${enqueued} jobs`);
    } catch (err) {
      console.error('compact-matter enqueue failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

// M4 — Nightly playbook tier promotion. Recomputes matched_count +
// accepted_when_matched_count per playbook from audit_log and applies
// the draft → org / org → draft transitions. Idempotent. 02:00 so it
// runs after most stage decisions have been recorded for the day.
cron.schedule(
  '0 2 * * *',
  async () => {
    try {
      const result = await runPromotePlaybooks(db);
      if (result.promoted > 0 || result.demoted > 0) {
        console.log(
          `playbook tiers: scanned=${result.scanned} promoted=${result.promoted} demoted=${result.demoted}`,
        );
      }
    } catch (err) {
      console.error('promote-playbooks failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

// M1 — Weekly rejection-reason mining. Clusters lawyer rejection
// reasons from audit_log and writes proposals to rejection_clusters
// for admin review in /admin/rejection-themes. Sunday 09:00 so admins
// see fresh clusters at the start of the work week. No-ops when there
// are fewer than 2 rejections in the lookback window.
cron.schedule(
  '0 9 * * 0',
  async () => {
    try {
      const result = await runMineRejections(db, { lookbackDays: 7 });
      console.log(
        `rejection mining: ${result.rejectionCount} rejections → ${result.clusterCount} clusters` +
          (result.skipped ? ` (skipped: ${result.skipped})` : ''),
      );
    } catch (err) {
      console.error('rejection mining failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

// Weekly re-enrichment of counterparties with recent activity. Behavioral
// profiles drift as new matters close — this keeps the LLM-extracted
// patterns fresh without bombarding the AI service on every matter event.
cron.schedule(
  '0 8 * * 1',
  async () => {
    try {
      const active = await db.execute(sql`
        SELECT DISTINCT c.id
        FROM counterparties c
        JOIN matters m ON m.counterparty_id = c.id
        WHERE m.updated_at > now() - INTERVAL '90 days'
      `);
      const ids = (active as unknown as Array<{ id: string }>).map((r) => r.id);
      for (const id of ids) {
        await db.insert(jobs).values({
          kind: 'enrich_counterparty_memory',
          payload: { counterparty_id: id },
        });
      }
      console.log(`re-enrichment: enqueued ${ids.length} counterparty jobs`);
    } catch (err) {
      console.error('weekly re-enrichment failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

console.log(
  `Worker started — digest cron: '${env.DIGEST_CRON}' in ${env.DIGEST_TIMEZONE}`,
);
// Graceful shutdown — close the Playwright browser if it was lazy-
// launched. The poll loop is fire-and-forget so we don't await it.
async function shutdown(signal: string) {
  console.log(`worker: received ${signal}, shutting down`);
  await closeSnapshotBrowser();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

pollLoop();
