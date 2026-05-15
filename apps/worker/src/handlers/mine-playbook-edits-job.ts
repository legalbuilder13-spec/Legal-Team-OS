import type { Db, Job } from '@legal/db';
import { runMinePlaybookEdits } from './mine-playbook-edits.js';
import { env } from '../env.js';

// M7 follow-up — single-matter job handler. Triggered by web's
// matters.setStatus when a matter transitions to 'closed'. Calls
// runMinePlaybookEdits scoped to that matter only.
//
// Honors the same M7_ENABLED gate as the weekly cron. Job is always
// enqueued; handler decides whether to actually run based on env.

interface MinePlaybookEditsJobPayload {
  matter_id?: string;
}

export async function handleMinePlaybookEditsJob(db: Db, job: Job): Promise<void> {
  const payload = (job.payload ?? null) as MinePlaybookEditsJobPayload | null;
  const matterId = payload?.matter_id;
  const result = await runMinePlaybookEdits(db, {
    mode: env.M7_ENABLED,
    matterId,
  });
  console.log(
    `mine-playbook-edits [matter=${matterId ?? 'none'}]: ${result.candidateCount} candidates → ${result.proposalCount} proposals` +
      (result.skipped ? ` (skipped: ${result.skipped})` : ''),
  );
}
