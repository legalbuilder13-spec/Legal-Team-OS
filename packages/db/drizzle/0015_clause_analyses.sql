-- Stage 4 clause analysis. Per parsed clause from matter_document_clauses,
-- the analyze-clause worker calls the AI service with the clause text +
-- the relevant playbook positions, and the AI returns one of three tags:
-- STANDARD (matches our standard position), MODIFIED (deviates within
-- acceptable range; redline suggested), FLAGGED (material deviation;
-- attorney attention required). Each analysis is tied to ONE position
-- (the best match); citations to additional positions / prior matters /
-- knowledge articles live in the citations jsonb.

CREATE TYPE "clause_tag" AS ENUM ('STANDARD', 'MODIFIED', 'FLAGGED');

CREATE TABLE "clause_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clause_id" uuid NOT NULL REFERENCES "matter_document_clauses"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "matter_documents"("id") ON DELETE CASCADE,
  "matter_id" uuid NOT NULL REFERENCES "matters"("id") ON DELETE CASCADE,
  "playbook_position_id" uuid REFERENCES "playbook_positions"("id") ON DELETE SET NULL,
  "tag" "clause_tag" NOT NULL,
  "reasoning" text NOT NULL,
  "suggested_redline" text,
  "model_version" text NOT NULL,
  "citations" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "attorney_decision" text,
  "attorney_modified_redline" text,
  "decided_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "clause_analyses_clause_uq" UNIQUE ("clause_id")
);

CREATE INDEX "clause_analyses_document_idx" ON "clause_analyses" ("document_id");
CREATE INDEX "clause_analyses_matter_idx" ON "clause_analyses" ("matter_id");
CREATE INDEX "clause_analyses_tag_idx" ON "clause_analyses" ("tag");

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'analyze_document_clauses';
ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'analyze_clause';
