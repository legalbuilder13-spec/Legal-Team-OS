-- Cross-matter cache for Stage 3 context cards. Same entity referenced by
-- multiple matters hits the same cached payload; per-source TTLs (1h SF,
-- 30min Slack, 1d Notion/Drive, 7d similar_matters) live in @legal/types
-- INSIGHT_CARD_TTL_SECONDS — handlers compute expires_at at write time.
--
-- Eviction: handlers check expires_at on read; no background sweeper yet.
-- The expires_at index supports a future cleanup job that DELETEs expired
-- rows once volumes are large enough to matter.

CREATE TABLE "context_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "entity_key" text NOT NULL,
  "query_hash" text NOT NULL DEFAULT 'v1',
  "payload" jsonb NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "context_cache_key_uq" UNIQUE ("source", "entity_key", "query_hash")
);

CREATE INDEX "context_cache_expires_idx" ON "context_cache" ("expires_at");
