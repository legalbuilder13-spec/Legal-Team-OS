-- PR #6 — Decompose templates into reusable clauses.
--
-- Templates today are monolithic — one body of text per template. If
-- 12 vendor MSA templates share a "governing law" clause, that clause
-- is duplicated 12 times. When the firm's standard governing-law
-- position changes, you update 12 templates.
--
-- This migration adds a clause library (`clauses`), a join table
-- (`template_clauses`), and a proposal queue (`clause_extractions`)
-- populated by an AI extraction job. Existing templates are NOT
-- migrated automatically — backfill happens by enqueuing
-- `extract_template_clauses` jobs that propose clause splits for
-- lawyer review.

CREATE TYPE "clause_status" AS ENUM ('draft', 'approved', 'archived');

CREATE TABLE "clauses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "practice_area" "practice_area" NOT NULL,
  "name" text NOT NULL,
  "body" text NOT NULL,
  "jurisdictions" text[] NOT NULL DEFAULT '{}',
  "is_canonical" boolean NOT NULL DEFAULT false,
  "status" "clause_status" NOT NULL DEFAULT 'draft',
  "supersedes_id" uuid REFERENCES "clauses"("id") ON DELETE SET NULL,
  "source_template_id" uuid REFERENCES "templates"("id") ON DELETE SET NULL,
  "embedding" vector(1024),
  "embedding_updated_at" timestamp with time zone,
  "content_hash" text,
  "owner_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "clauses_practice_area_idx" ON "clauses" ("practice_area", "status");
CREATE INDEX "clauses_canonical_idx" ON "clauses" ("is_canonical", "practice_area")
  WHERE "is_canonical" = true;
CREATE INDEX "clauses_embedding_idx"
  ON "clauses"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 50);

CREATE TABLE "template_clauses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "templates"("id") ON DELETE CASCADE,
  "clause_id" uuid NOT NULL REFERENCES "clauses"("id") ON DELETE RESTRICT,
  "position" integer NOT NULL,
  -- Optional per-template tweak that overrides the canonical clause
  -- body when this template renders. Use sparingly — the whole point
  -- of the clause library is shared text.
  "override_text" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "template_clauses_unique_idx"
  ON "template_clauses" ("template_id", "clause_id", "position");
CREATE INDEX "template_clauses_template_idx"
  ON "template_clauses" ("template_id", "position");

CREATE TYPE "clause_extraction_status" AS ENUM ('pending', 'accepted', 'dismissed');

CREATE TABLE "clause_extractions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_template_id" uuid NOT NULL REFERENCES "templates"("id") ON DELETE CASCADE,
  "proposed_name" text NOT NULL,
  "proposed_body" text NOT NULL,
  "proposed_jurisdictions" text[] NOT NULL DEFAULT '{}',
  "proposed_position" integer NOT NULL,
  "rationale" text,
  "status" "clause_extraction_status" NOT NULL DEFAULT 'pending',
  "approved_clause_id" uuid REFERENCES "clauses"("id") ON DELETE SET NULL,
  "actioned_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actioned_at" timestamp with time zone,
  -- Groups all extractions from one run. A re-run on the same template
  -- creates a new run; the prior run's extractions stay around as
  -- history (and to avoid losing accept/dismiss decisions).
  "extraction_run_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "clause_extractions_status_idx"
  ON "clause_extractions" ("status", "created_at" DESC);
CREATE INDEX "clause_extractions_template_idx"
  ON "clause_extractions" ("source_template_id", "extraction_run_id");

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'extract_template_clauses';
