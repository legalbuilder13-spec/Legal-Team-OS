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
import { runMineRevisions } from './handlers/mine-revisions.js';
import { runMinePlaybookEdits } from './handlers/mine-playbook-edits.js';
import { handleMinePlaybookEditsJob } from './handlers/mine-playbook-edits-job.js';
import { handleApplyPlaybookEditToNotionJob } from './handlers/apply-playbook-edit-to-notion.js';
import { runNotifyPlaybookEdits } from './handlers/notify-playbook-edits.js';
import { runNudgeMissedPlaybooks } from './handlers/nudge-missed-playbooks.js';
import {
  enqueueStaleContentEmbeddings,
  handleEmbedContentJob,
} from './handlers/embed-content.js';
import { handleExtractTemplateClausesJob } from './handlers/extract-template-clauses.js';
import { runDetectConflicts } from './handlers/detect-conflicts.js';
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
    case 'mine_playbook_edits':
      await handleMinePlaybookEditsJob(db, job);
      break;
    case 'apply_playbook_edit_to_notion':
      await handleApplyPlaybookEditToNotionJob(db, job);
      break;
    case 'embed_content':
      await handleEmbedContentJob(db, job);
      break;
    case 'extract_template_clauses':
      await handleExtractTemplateClausesJob(db, job);
      break;
    case 'detect_conflicts':
      await runDetectConflicts(db);
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

// M6 — Daily nudge cycle. Surfaces accepted stages from the last 7d
// that haven't been saved as playbooks but would have matched ≥2
// other recent matters. Sends a Slack DM to admin users. 08:00
// local time so it lands with the start-of-day digest.
cron.schedule(
  '0 8 * * *',
  async () => {
    try {
      const result = await runNudgeMissedPlaybooks(db);
      if (result.candidates > 0) {
        console.log(
          `nudge-missed-playbooks: ${result.candidates} candidates, ${result.dmsSent} DMs sent` +
            (result.skipped ? ` (skipped: ${result.skipped})` : ''),
        );
      }
    } catch (err) {
      console.error('nudge-missed-playbooks failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

// M5 — Weekly mining of lawyer revisions into domain_config patches.
// Reads lawyer_revised_output rows from the last 30d, diffs vs.
// original, calls the AI service to extract terminology / verb /
// jurisdiction patterns. Sunday 10:00 in DIGEST_TIMEZONE so the
// proposals land just after the M1 rejection-themes batch.
cron.schedule(
  '0 10 * * 0',
  async () => {
    try {
      const result = await runMineRevisions(db, { lookbackDays: 30 });
      console.log(
        `mine-revisions: ${result.revisionCount} revisions → ${result.proposalCount} proposals` +
          (result.skipped ? ` (skipped: ${result.skipped})` : ''),
      );
    } catch (err) {
      console.error('mine-revisions failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

// M7 — Weekly playbook-edit mining. Looks at playbooks that matched
// in Stage 1 on matters that have since closed, and asks the AI to
// propose targeted edits to those playbooks based on the matter's
// final accepted summary. Sunday 11:00 in DIGEST_TIMEZONE so it runs
// just after the M5 mine-revisions batch.
//
// Gated by M7_ENABLED (off | shadow | on). Default 'off' — the cron
// fires but short-circuits with skipped='disabled'.
cron.schedule(
  '0 11 * * 0',
  async () => {
    try {
      const result = await runMinePlaybookEdits(db, {
        lookbackDays: 7,
        mode: env.M7_ENABLED,
      });
      console.log(
        `mine-playbook-edits: ${result.candidateCount} candidates → ${result.proposalCount} proposals` +
          (result.skipped ? ` (skipped: ${result.skipped})` : ''),
      );
    } catch (err) {
      console.error('mine-playbook-edits failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

// M7 follow-up — Daily Slack DM cron for pending playbook edit
// proposals. Sends one DM per admin batching the new proposals with
// accept/dismiss buttons. Runs at 09:30 in DIGEST_TIMEZONE, just
// after the M6 nudge at 08:00. Gated by M7_SLACK_NOTIFY_ENABLED.
cron.schedule(
  '30 9 * * *',
  async () => {
    try {
      const result = await runNotifyPlaybookEdits(db);
      console.log(
        `notify-playbook-edits: ${result.pendingCount} pending → ${result.dmsSent} DMs sent` +
          (result.skipped ? ` (skipped: ${result.skipped})` : ''),
      );
    } catch (err) {
      console.error('notify-playbook-edits failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

// PR #7 / M8 — Weekly conflict-detection cron. Runs the structural
// detectors (duplicate canonical clauses, rule priority collisions,
// near-duplicate playbooks by embedding similarity) and writes new
// detected_conflicts rows. Idempotent — already-active conflicts
// aren't re-flagged thanks to the unique-on-active index.
cron.schedule(
  '0 11 * * 0',
  async () => {
    try {
      const r = await runDetectConflicts(db);
      if (r.totalNewConflicts > 0) {
        console.log(
          `detect-conflicts: ${r.totalNewConflicts} new (clauses=${r.duplicateClauses}, rule_collisions=${r.rulePriorityCollisions}, near_dup_playbooks=${r.nearDuplicatePlaybooks})`,
        );
      }
    } catch (err) {
      console.error('detect-conflicts failed:', err);
    }
  },
  { timezone: env.DIGEST_TIMEZONE },
);

// Daily content-embedding backfill. Scans the five content tables
// (knowledge_articles, templates, rules, execution_patterns, playbooks)
// for active rows whose embedding is NULL and enqueues embed_content
// jobs. Runs at 03:00 so backfill batches finish before the M-jobs
// consume signal. The handler short-circuits on stable content_hash
// so re-runs cost nothing on already-embedded rows.
cron.schedule(
  '0 3 * * *',
  async () => {
    try {
      const enqueued = await enqueueStaleContentEmbeddings(db);
      if (enqueued > 0) console.log(`embed-content backfill: enqueued ${enqueued} jobs`);
    } catch (err) {
      console.error('embed-content backfill failed:', err);
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
