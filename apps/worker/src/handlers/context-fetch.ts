import { eq } from 'drizzle-orm';
import { matters, counterparties, auditLog, type Db, type Job } from '@legal/db';
import { env } from '../env';
import { hostnameFromWebsite } from '../utils';

interface ContextFetchPayload {
  matter_id: string;
  counterparty_name?: string | null;
  counterparty_domain?: string | null;
}

interface ContextCardResponse {
  source: 'salesforce' | 'slack_history' | 'manual';
  fetched_at: string;
  data: Record<string, unknown>;
}

interface SalesforceAccountRecord {
  Id: string;
  Name: string;
  Website?: string | null;
  Industry?: string | null;
  AnnualRevenue?: number | null;
  Owner?: { Name?: string } | null;
}

export async function handleContextFetchJob(db: Db, job: Job) {
  const payload = job.payload as unknown as ContextFetchPayload;
  if (!payload.counterparty_name && !payload.counterparty_domain) {
    return;
  }

  const res = await fetch(`${env.AI_SERVICE_URL}/context`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      matter_id: payload.matter_id,
      counterparty_name: payload.counterparty_name ?? null,
      counterparty_domain: payload.counterparty_domain ?? null,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`context fetch failed: ${res.status} ${body}`);
  }

  const card = (await res.json()) as ContextCardResponse | null;
  if (!card) return;

  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, payload.matter_id),
  });
  if (!matter) {
    throw new Error(`matter ${payload.matter_id} not found`);
  }

  const existingContext = (matter.context ?? {}) as Record<string, unknown>;
  await db
    .update(matters)
    .set({
      context: { ...existingContext, [card.source]: card },
      updatedAt: new Date(),
    })
    .where(eq(matters.id, matter.id));

  const records = (card.data?.records as SalesforceAccountRecord[] | undefined) ?? [];
  if (records.length === 1 && matter.counterpartyId) {
    const top = records[0]!;
    await db
      .update(counterparties)
      .set({
        salesforceAccountId: top.Id,
        domain: hostnameFromWebsite(top.Website),
        metadata: {
          industry: top.Industry ?? null,
          annualRevenue: top.AnnualRevenue ?? null,
          ownerName: top.Owner?.Name ?? null,
        },
        updatedAt: new Date(),
      })
      .where(eq(counterparties.id, matter.counterpartyId));
  }

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: matter.id,
    action: 'matter.context_fetched',
    details: { source: card.source, recordCount: records.length },
  });
}
