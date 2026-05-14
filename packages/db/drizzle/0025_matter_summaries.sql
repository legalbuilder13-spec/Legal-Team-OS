-- M2 — Matter compression at close. One row per matter; the
-- compact-matter worker handler regenerates the summary when the
-- source_version_hash changes (new stages, new sources, new audit
-- events). The summary_embedding feeds the K-NN retrieval in
-- tool_history.ts + context-fetch-similar-matters.ts as a higher-
-- signal alternative to matters.embedding (which only sees the
-- intake text, not the resolved outcome).
--
-- Tier: episodic memory consolidation. Hermes-equivalent: /compress
-- session summary, but immutable + auditable.

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'compact_matter';

CREATE TABLE "matter_summaries" (
  "matter_id" uuid PRIMARY KEY REFERENCES "matters"("id") ON DELETE CASCADE,
  "summary_md" text NOT NULL,
  "summary_embedding" vector(1024),
  "source_version_hash" text NOT NULL,
  "model" text,
  "tokens_in" integer NOT NULL DEFAULT 0,
  "tokens_out" integer NOT NULL DEFAULT 0,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "generated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- pgvector IVFFlat index for cosine-distance K-NN. Conservatively
-- sized for thousands of matters; resize when row count crosses 100k.
CREATE INDEX "matter_summaries_embedding_idx"
  ON "matter_summaries"
  USING ivfflat ("summary_embedding" vector_cosine_ops)
  WITH (lists = 50);

CREATE INDEX "matter_summaries_generated_at_idx"
  ON "matter_summaries" ("generated_at" DESC);
