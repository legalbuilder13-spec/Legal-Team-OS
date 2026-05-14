-- PRD §7.2: Pre-review analysis pipeline foundation. Adds three tables that
-- record auto-pipeline runs (Stage 0 pre-merits + Stage 1 playbook check) and
-- lawyer-invoked research-tool runs (Stage 2a statutory, 2b case-law, 3
-- deconstruct). Every claim made by any stage traces to a
-- matter_analysis_sources row; this is the audit backbone.
--
-- One matter_analyses row per analysis run; one stage row per pipeline stage
-- (auto) or tool invocation (lawyer-invoked); one source row per
-- statute/case/guidance/document the stage relied upon.

CREATE TYPE "analysis_status" AS ENUM (
  'pending',
  'running',
  'complete',
  'failed',
  'escalated'
);

CREATE TYPE "analysis_stage_name" AS ENUM (
  'pre_merits',
  'guidance',
  'statutory',
  'case_law',
  'deconstruct'
);

CREATE TYPE "analysis_stage_status" AS ENUM (
  'skipped',
  'running',
  'complete',
  'failed',
  'deferred'
);

CREATE TYPE "analysis_source_type" AS ENUM (
  'notion',
  'statute',
  'regulation',
  'case',
  'guidance',
  'prior_matter',
  'webfetch'
);

CREATE TYPE "analysis_verification_status" AS ENUM (
  'pending',
  'verified',
  'minor_discrepancy',
  'material_discrepancy',
  'not_found',
  'unverifiable'
);

CREATE TYPE "analysis_confidence" AS ENUM (
  'HIGH',
  'MEDIUM',
  'LOW',
  'SPLIT',
  'N_A'
);

CREATE TABLE "matter_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "matter_id" uuid NOT NULL REFERENCES "matters"("id") ON DELETE CASCADE,
  "pipeline_version" text NOT NULL,
  "status" "analysis_status" NOT NULL DEFAULT 'pending',
  "overall_confidence" "analysis_confidence" NOT NULL DEFAULT 'N_A',
  "escalation_reason" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "total_cost_cents" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "matter_analyses_matter_idx" ON "matter_analyses" ("matter_id", "created_at" DESC);
CREATE INDEX "matter_analyses_status_idx" ON "matter_analyses" ("status");

CREATE TABLE "matter_analysis_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "analysis_id" uuid NOT NULL REFERENCES "matter_analyses"("id") ON DELETE CASCADE,
  "stage_name" "analysis_stage_name" NOT NULL,
  "status" "analysis_stage_status" NOT NULL DEFAULT 'running',
  "input_hash" text NOT NULL,
  "output_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "confidence" "analysis_confidence" NOT NULL DEFAULT 'N_A',
  "model" text,
  "tokens_in" integer NOT NULL DEFAULT 0,
  "tokens_out" integer NOT NULL DEFAULT 0,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "retries" integer NOT NULL DEFAULT 0,
  "audit_notes" text,
  "invoked_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "matter_analysis_stages_analysis_idx" ON "matter_analysis_stages" ("analysis_id", "created_at");
CREATE INDEX "matter_analysis_stages_name_idx" ON "matter_analysis_stages" ("stage_name", "status");
CREATE INDEX "matter_analysis_stages_dedup_idx" ON "matter_analysis_stages" ("analysis_id", "stage_name", "input_hash");

CREATE TABLE "matter_analysis_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stage_id" uuid NOT NULL REFERENCES "matter_analysis_stages"("id") ON DELETE CASCADE,
  "source_type" "analysis_source_type" NOT NULL,
  "citation" text NOT NULL,
  "url" text,
  "retrieved_at" timestamp with time zone NOT NULL DEFAULT now(),
  "hash" text NOT NULL,
  "verification_status" "analysis_verification_status" NOT NULL DEFAULT 'pending',
  "verification_evidence_url" text,
  "raw_excerpt" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "matter_analysis_sources_stage_idx" ON "matter_analysis_sources" ("stage_id");
CREATE INDEX "matter_analysis_sources_hash_idx" ON "matter_analysis_sources" ("hash");
CREATE INDEX "matter_analysis_sources_citation_idx" ON "matter_analysis_sources" ("citation");

-- New job kinds. 'analyze' is the auto pipeline (always runs after triage).
-- The three 'run_*' kinds are the lawyer-invoked research tools (Phase 2+);
-- adding the enum values now keeps the job dispatcher API stable.
ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'analyze';
ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'run_statutory';
ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'run_case_law';
ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'run_deconstruct';
