-- M5 — Capture lawyer revisions for dialectic org-config mining.
--
-- 1) Adds lawyer_revised_output to matter_analysis_stages. When the
--    lawyer accepts a stage with a revision, the revised text is
--    persisted here. The mining cron diffs revised vs original to
--    extract terminology/verb swaps and high-scrutiny patterns.
--
-- 2) New domain_config_proposals table holds pending patches the
--    mining cron emits. The /admin/domain-config page renders these
--    as a queue; admins accept (which applies the patch to the org's
--    domain_config) or dismiss.

ALTER TABLE "matter_analysis_stages"
  ADD COLUMN "lawyer_revised_output" jsonb;

CREATE TYPE "domain_config_proposal_status" AS ENUM (
  'pending',
  'accepted',
  'dismissed'
);

CREATE TABLE "domain_config_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "patch_path" text NOT NULL,
  "patch_value" jsonb NOT NULL,
  "rationale" text NOT NULL,
  "evidence_count" integer NOT NULL DEFAULT 1,
  "evidence_stage_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" "domain_config_proposal_status" NOT NULL DEFAULT 'pending',
  "actioned_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actioned_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "domain_config_proposals_org_status_idx"
  ON "domain_config_proposals" ("organization_id", "status", "created_at" DESC);
