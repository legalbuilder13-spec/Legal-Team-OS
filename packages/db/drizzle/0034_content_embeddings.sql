-- Embedding columns across the five content tables (playbooks,
-- knowledge_articles, templates, rules, execution_patterns) so they
-- can all participate in semantic search via the same K-NN backend
-- already used by matter_summaries.
--
-- Each table gets three columns:
--   * embedding (vector(1024))    — voyage-law-2 output, nullable until backfilled
--   * embedding_updated_at        — when the embedding was last computed
--   * content_hash                — SHA-256 of the embedded text. The worker
--                                   short-circuits when content_hash matches,
--                                   so no Voyage cost on a no-op edit.
--
-- A new job_kind 'embed_content' carries (entity_type, entity_id) payload
-- and is consumed by the polymorphic embed-content handler. The existing
-- 'generate_embedding' job_kind stays matter-specific and untouched.

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'embed_content';

-- knowledge_articles
ALTER TABLE "knowledge_articles"
  ADD COLUMN "embedding" vector(1024),
  ADD COLUMN "embedding_updated_at" timestamp with time zone,
  ADD COLUMN "content_hash" text;

CREATE INDEX "knowledge_articles_embedding_idx"
  ON "knowledge_articles"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 50);

-- templates
ALTER TABLE "templates"
  ADD COLUMN "embedding" vector(1024),
  ADD COLUMN "embedding_updated_at" timestamp with time zone,
  ADD COLUMN "content_hash" text;

CREATE INDEX "templates_embedding_idx"
  ON "templates"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 50);

-- rules
ALTER TABLE "rules"
  ADD COLUMN "embedding" vector(1024),
  ADD COLUMN "embedding_updated_at" timestamp with time zone,
  ADD COLUMN "content_hash" text;

CREATE INDEX "rules_embedding_idx"
  ON "rules"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 50);

-- execution_patterns
ALTER TABLE "execution_patterns"
  ADD COLUMN "embedding" vector(1024),
  ADD COLUMN "embedding_updated_at" timestamp with time zone,
  ADD COLUMN "content_hash" text;

CREATE INDEX "execution_patterns_embedding_idx"
  ON "execution_patterns"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 50);

-- playbooks (the table itself has never had an embedding column —
-- only playbook_positions did, via migration 0001 / 0006. Add the
-- column + metadata here so playbooks can participate in semantic
-- search alongside the other content tables).
ALTER TABLE "playbooks"
  ADD COLUMN "embedding" vector(1024),
  ADD COLUMN "embedding_updated_at" timestamp with time zone,
  ADD COLUMN "content_hash" text;

CREATE INDEX "playbooks_embedding_idx"
  ON "playbooks"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 50);
