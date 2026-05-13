import { z } from 'zod';

// Stage-3 insight card data model (PRD §6.2.2). Every per-source context-
// fetch sub-job emits one card; matters.context is keyed by source name.
//
// Design goals:
// - Discriminated union on `source` so UI rendering can dispatch by literal
//   without losing type information on the per-source `raw` payload.
// - Fixed shape across sources: every card has primary key-value chips, a
//   short relevance summary, an optional drill-down URL, and freshness
//   metadata (fetchedAt + staleAfter). The raw payload is preserved so
//   the copilot can drill into it via tool calls.
// - permissionsContext records which user's credentials were used to fetch
//   the data, so audits can show "this card was sourced under user X's
//   ACLs at time T" — critical for permission-aware cross-system queries.

export const InsightCardSourceSchema = z.enum([
  'salesforce',
  'similar_matters',
  'counterparty_memory',
  'notion',
  'slack',
  'drive',
  'manual',
]);
export type InsightCardSource = z.infer<typeof InsightCardSourceSchema>;

export const InsightCardPrimaryFieldSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.union([z.string(), z.number()]),
});
export type InsightCardPrimaryField = z.infer<typeof InsightCardPrimaryFieldSchema>;

export const InsightCardPermissionsContextSchema = z.object({
  userId: z.string().uuid().optional(),
  scope: z.string().optional(),
  acquiredAt: z.string().datetime().optional(),
});
export type InsightCardPermissionsContext = z.infer<
  typeof InsightCardPermissionsContextSchema
>;

export const InsightCardSchema = z.object({
  source: InsightCardSourceSchema,
  fetchedAt: z.string().datetime(),
  staleAfter: z.string().datetime(),
  primary: z.array(InsightCardPrimaryFieldSchema).max(6).default([]),
  summary: z.string().max(500).optional(),
  drilldownUrl: z.string().url().optional(),
  permissionsContext: InsightCardPermissionsContextSchema.optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});
export type InsightCard = z.infer<typeof InsightCardSchema>;

// The shape of matters.context as of B1: a partial map keyed by source.
// Missing keys mean the source either hasn't been fetched yet, or wasn't
// applicable (e.g. salesforce when no counterparty is identified).
export type MatterContext = Partial<Record<InsightCardSource, InsightCard>>;

// Per-source TTL defaults — used by the cache layer (B4) and by callers
// that need to compute staleAfter when emitting a fresh card. Values are
// in seconds.
export const INSIGHT_CARD_TTL_SECONDS: Record<InsightCardSource, number> = {
  salesforce: 3600, // 1h — deal data changes frequently
  similar_matters: 86_400 * 7, // 7d — only changes when new matters close
  counterparty_memory: 86_400, // 1d
  notion: 86_400, // 1d — policy docs change rarely
  slack: 1800, // 30min — active conversations
  drive: 86_400, // 1d
  manual: Number.MAX_SAFE_INTEGER, // never stale (human-curated)
};

// Helper: compute the staleAfter timestamp for a freshly-fetched card.
export function computeStaleAfter(source: InsightCardSource, now = new Date()): string {
  const ttlMs = INSIGHT_CARD_TTL_SECONDS[source] * 1000;
  return new Date(now.getTime() + ttlMs).toISOString();
}

// Helper: is a card stale right now? Returns true if a refetch is warranted.
export function isCardStale(card: InsightCard, now = new Date()): boolean {
  return new Date(card.staleAfter).getTime() <= now.getTime();
}
