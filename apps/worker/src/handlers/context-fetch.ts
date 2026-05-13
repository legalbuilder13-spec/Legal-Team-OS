import { eq } from 'drizzle-orm';
import { matters, jobs, auditLog, type Db, type Job } from '@legal/db';

interface ContextFetchPayload {
  matter_id: string;
  counterparty_name?: string | null;
  counterparty_domain?: string | null;
}

// The original monolithic context_fetch handler is now a fan-out coordinator:
// it enqueues per-source sub-jobs and returns immediately. Each sub-job writes
// its own card into matters.context keyed by source. Slow sources can no
// longer block fast ones, and new sources (notion, slack, drive) plug in by
// adding a new sub-job kind here.
export async function handleContextFetchJob(db: Db, job: Job) {
  const payload = job.payload as unknown as ContextFetchPayload;
  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, payload.matter_id),
  });
  if (!matter) {
    throw new Error(`matter ${payload.matter_id} not found`);
  }

  const subJobs: Array<{ kind: 'context_fetch_salesforce' | 'context_fetch_similar_matters'; reason: string }> = [];

  if (payload.counterparty_name || payload.counterparty_domain) {
    subJobs.push({ kind: 'context_fetch_salesforce', reason: 'counterparty present' });
  }

  // Similar-matters context is useful regardless of counterparty — searches
  // by request text against prior closed matters.
  subJobs.push({ kind: 'context_fetch_similar_matters', reason: 'always' });

  for (const sub of subJobs) {
    await db.insert(jobs).values({
      kind: sub.kind,
      matterId: matter.id,
      payload: {
        matter_id: matter.id,
        counterparty_name: payload.counterparty_name ?? null,
        counterparty_domain: payload.counterparty_domain ?? null,
      },
    });
  }

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: matter.id,
    action: 'matter.context_fanout',
    details: {
      enqueued: subJobs.map((s) => s.kind),
      counterpartyName: payload.counterparty_name ?? null,
      counterpartyDomain: payload.counterparty_domain ?? null,
    },
  });
}
