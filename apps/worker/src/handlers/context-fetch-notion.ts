import { eq } from 'drizzle-orm';
import { matters, auditLog, type Db, type Job } from '@legal/db';
import {
  computeStaleAfter,
  type InsightCard,
  type InsightCardPrimaryField,
} from '@legal/types';
import { env } from '../env.js';
import { searchNotion } from '../integrations/notion.js';

interface ContextFetchPayload {
  matter_id: string;
  counterparty_name?: string | null;
  counterparty_domain?: string | null;
}

// Per-source sub-handler enqueued by the context_fetch coordinator. Searches
// the connected Notion workspace for pages mentioning the counterparty and
// writes an InsightCard into matters.context.notion. Falls back to a tiny
// 'connected, no matches' card so the UI shows the source is wired up.
export async function handleContextFetchNotionJob(db: Db, job: Job) {
  if (!env.NOTION_API_KEY) {
    console.log('context_fetch_notion: NOTION_API_KEY not set, skipping');
    return;
  }

  const payload = job.payload as unknown as ContextFetchPayload;
  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, payload.matter_id),
  });
  if (!matter) {
    throw new Error(`matter ${payload.matter_id} not found`);
  }

  // Build the search query. Notion's search is global keyword match — we
  // prioritize the counterparty name, fall back to the matter title.
  const query =
    payload.counterparty_name?.trim() ||
    payload.counterparty_domain?.trim() ||
    matter.title;

  const hits = await searchNotion(env.NOTION_API_KEY, query, 8);

  const primary: InsightCardPrimaryField[] = [];
  let summary: string;
  let drilldownUrl: string | undefined;

  if (hits.length === 0) {
    summary = `No Notion pages mention ${query}.`;
  } else {
    primary.push({ label: 'Pages found', value: hits.length });
    if (hits[0]) {
      primary.push({ label: 'Most recent', value: hits[0].title });
      drilldownUrl = hits[0].url;
    }
    const recentDate = hits[0]?.lastEditedAt
      ? new Date(hits[0].lastEditedAt).toLocaleDateString()
      : null;
    summary =
      hits.length === 1
        ? `1 Notion page mentions ${query}${recentDate ? ` (edited ${recentDate})` : ''}.`
        : `${hits.length} Notion pages mention ${query}. Most recent: "${hits[0]?.title}"${recentDate ? ` (${recentDate})` : ''}.`;
  }

  const card: InsightCard = {
    source: 'notion',
    fetchedAt: new Date().toISOString(),
    staleAfter: computeStaleAfter('notion'),
    primary,
    summary,
    drilldownUrl,
    raw: {
      query,
      hits: hits.slice(0, 5),
    },
  };

  const existingContext = (matter.context ?? {}) as Record<string, unknown>;
  await db
    .update(matters)
    .set({
      context: { ...existingContext, notion: card },
      updatedAt: new Date(),
    })
    .where(eq(matters.id, matter.id));

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: matter.id,
    action: 'matter.context_fetched',
    details: { source: 'notion', hitCount: hits.length, query },
  });
}
