import { and, eq, sql } from 'drizzle-orm';
import { contextCache, type Db } from '@legal/db';
import type { InsightCard, InsightCardSource } from '@legal/types';

// Cross-matter cache for Stage 3 context cards. Keyed by (source, entity_key,
// query_hash) so two matters about the same counterparty can share a fetch.
// TTLs are baked into the cards' staleAfter field at write time; this cache
// stores expires_at directly so SELECTs can filter cheaply.

function normalizeEntityKey(key: string): string {
  return key.trim().toLowerCase();
}

export interface CacheLookupResult {
  card: InsightCard;
  fetchedAt: Date;
  ageSeconds: number;
}

export async function getCachedCard(
  db: Db,
  source: InsightCardSource,
  entityKey: string,
  queryHash = 'v1',
): Promise<CacheLookupResult | null> {
  const normalized = normalizeEntityKey(entityKey);
  if (!normalized) return null;

  const row = await db
    .select({
      payload: contextCache.payload,
      fetchedAt: contextCache.fetchedAt,
      expiresAt: contextCache.expiresAt,
    })
    .from(contextCache)
    .where(
      and(
        eq(contextCache.source, source),
        eq(contextCache.entityKey, normalized),
        eq(contextCache.queryHash, queryHash),
        sql`${contextCache.expiresAt} > now()`,
      ),
    )
    .limit(1);

  const hit = row[0];
  if (!hit) return null;

  return {
    card: hit.payload as unknown as InsightCard,
    fetchedAt: hit.fetchedAt,
    ageSeconds: Math.round((Date.now() - hit.fetchedAt.getTime()) / 1000),
  };
}

export async function setCachedCard(
  db: Db,
  source: InsightCardSource,
  entityKey: string,
  card: InsightCard,
  queryHash = 'v1',
): Promise<void> {
  const normalized = normalizeEntityKey(entityKey);
  if (!normalized) return;

  await db
    .insert(contextCache)
    .values({
      source,
      entityKey: normalized,
      queryHash,
      payload: card as unknown as Record<string, unknown>,
      fetchedAt: new Date(card.fetchedAt),
      expiresAt: new Date(card.staleAfter),
    })
    .onConflictDoUpdate({
      target: [contextCache.source, contextCache.entityKey, contextCache.queryHash],
      set: {
        payload: card as unknown as Record<string, unknown>,
        fetchedAt: new Date(card.fetchedAt),
        expiresAt: new Date(card.staleAfter),
      },
    });
}
