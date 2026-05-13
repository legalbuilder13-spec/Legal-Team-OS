import { eq } from 'drizzle-orm';
import { matters, auditLog, type Db, type Job } from '@legal/db';
import {
  computeStaleAfter,
  type InsightCard,
  type InsightCardPrimaryField,
} from '@legal/types';
import { env } from '../env.js';
import { searchDrive } from '../integrations/google-drive.js';
import { getCachedCard, setCachedCard } from '../cache.js';

interface ContextFetchPayload {
  matter_id: string;
  counterparty_name?: string | null;
  counterparty_domain?: string | null;
}

// Per-source sub-handler enqueued by the context_fetch coordinator. Searches
// the connected Drive workspace for files mentioning the counterparty. Scopes
// to a default folder if GOOGLE_DRIVE_DEFAULT_FOLDER_ID is set (recommended
// to keep search results legal-team-relevant rather than org-wide).
export async function handleContextFetchDriveJob(db: Db, job: Job) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('context_fetch_drive: GOOGLE_SERVICE_ACCOUNT_JSON not set, skipping');
    return;
  }

  const payload = job.payload as unknown as ContextFetchPayload;
  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, payload.matter_id),
  });
  if (!matter) {
    throw new Error(`matter ${payload.matter_id} not found`);
  }

  const query =
    payload.counterparty_name?.trim() ||
    payload.counterparty_domain?.trim();
  if (!query) {
    return;
  }

  const cached = await getCachedCard(db, 'drive', query);
  if (cached) {
    const existingContext = (matter.context ?? {}) as Record<string, unknown>;
    await db
      .update(matters)
      .set({
        context: { ...existingContext, drive: cached.card },
        updatedAt: new Date(),
      })
      .where(eq(matters.id, matter.id));
    await db.insert(auditLog).values({
      actorKind: 'system',
      matterId: matter.id,
      action: 'matter.context_fetched',
      details: { source: 'drive', cacheHit: true, ageSeconds: cached.ageSeconds, query },
    });
    return;
  }

  const hits = await searchDrive(env.GOOGLE_SERVICE_ACCOUNT_JSON, query, {
    folderId: env.GOOGLE_DRIVE_DEFAULT_FOLDER_ID,
    limit: 10,
  });

  const primary: InsightCardPrimaryField[] = [];
  let summary: string;
  let drilldownUrl: string | undefined;

  if (hits.length === 0) {
    summary = `No Drive files mention ${query}.`;
  } else {
    primary.push({ label: 'Files found', value: hits.length });
    const top = hits[0];
    if (top) {
      primary.push({ label: 'Most recent', value: top.name });
      drilldownUrl = top.webViewLink ?? undefined;
    }
    const recentDate = top?.modifiedTime
      ? new Date(top.modifiedTime).toLocaleDateString()
      : null;
    summary =
      hits.length === 1
        ? `1 Drive file mentions ${query}${recentDate ? ` (modified ${recentDate})` : ''}.`
        : `${hits.length} Drive files mention ${query}. Most recent: "${top?.name}"${recentDate ? ` (${recentDate})` : ''}.`;
  }

  const card: InsightCard = {
    source: 'drive',
    fetchedAt: new Date().toISOString(),
    staleAfter: computeStaleAfter('drive'),
    primary,
    summary,
    drilldownUrl,
    raw: {
      query,
      folderId: env.GOOGLE_DRIVE_DEFAULT_FOLDER_ID ?? null,
      hits: hits.slice(0, 5),
    },
  };

  const existingContext = (matter.context ?? {}) as Record<string, unknown>;
  await db
    .update(matters)
    .set({
      context: { ...existingContext, drive: card },
      updatedAt: new Date(),
    })
    .where(eq(matters.id, matter.id));

  await setCachedCard(db, 'drive', query, card);

  await db.insert(auditLog).values({
    actorKind: 'system',
    matterId: matter.id,
    action: 'matter.context_fetched',
    details: { source: 'drive', hitCount: hits.length, query, cacheHit: false },
  });
}
