import { eq } from 'drizzle-orm';
import { matters, counterparties, auditLog, type Db, type Job } from '@legal/db';
import {
  computeStaleAfter,
  type InsightCard,
  type InsightCardPrimaryField,
} from '@legal/types';
import { env } from '../env.js';
import { hostnameFromWebsite } from '../utils.js';

interface ContextFetchPayload {
  matter_id: string;
  counterparty_name?: string | null;
  counterparty_domain?: string | null;
}

interface LegacyContextCardResponse {
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

// Per-source sub-handler enqueued by the context_fetch coordinator. Calls
// the AI service /context endpoint (which queries Salesforce) and writes
// the result as an InsightCard into matters.context.salesforce.
export async function handleContextFetchSalesforceJob(db: Db, job: Job) {
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
    throw new Error(`context fetch (salesforce) failed: ${res.status} ${body}`);
  }

  const legacy = (await res.json()) as LegacyContextCardResponse | null;
  if (!legacy) return;

  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, payload.matter_id),
  });
  if (!matter) {
    throw new Error(`matter ${payload.matter_id} not found`);
  }

  const records = (legacy.data?.records as SalesforceAccountRecord[] | undefined) ?? [];
  const top = records[0];

  const primary: InsightCardPrimaryField[] = [];
  let summary: string;
  if (records.length === 0) {
    summary = `No Salesforce accounts matched ${payload.counterparty_name ?? payload.counterparty_domain}.`;
  } else if (records.length === 1 && top) {
    if (top.Industry) primary.push({ label: 'Industry', value: top.Industry });
    if (top.AnnualRevenue != null) {
      primary.push({ label: 'Revenue', value: `$${top.AnnualRevenue.toLocaleString()}` });
    }
    if (top.Owner?.Name) primary.push({ label: 'SF Owner', value: top.Owner.Name });
    if (top.Website) primary.push({ label: 'Website', value: top.Website });
    summary = `Salesforce account: ${top.Name}.`;
  } else {
    primary.push({ label: 'Matches', value: records.length });
    summary = `${records.length} Salesforce accounts matched — likely needs manual disambiguation.`;
  }

  const card: InsightCard = {
    source: 'salesforce',
    fetchedAt: legacy.fetched_at,
    staleAfter: computeStaleAfter('salesforce'),
    primary,
    summary,
    raw: { records, configured: legacy.data?.configured ?? true },
  };

  const existingContext = (matter.context ?? {}) as Record<string, unknown>;
  await db
    .update(matters)
    .set({
      context: { ...existingContext, salesforce: card },
      updatedAt: new Date(),
    })
    .where(eq(matters.id, matter.id));

  if (records.length === 1 && top && matter.counterpartyId) {
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
    details: { source: 'salesforce', recordCount: records.length },
  });
}
