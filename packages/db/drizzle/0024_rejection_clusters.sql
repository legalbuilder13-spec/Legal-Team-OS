-- M1 — Rejection-reason mining. Closes the loop opened by PR10
-- (lawyer_decision_reason). A weekly worker cron reads
-- audit_log entries for analysis.stage_rejected + analysis.stage_escalated,
-- groups them into themed clusters via an LLM skill, and writes one row
-- per cluster here. The admin dashboard renders the clusters as a
-- proposal queue: each cluster can become a playbook draft or a
-- domain_config rule patch.
--
-- Clusters are ephemeral aggregations of audit_log rows in a window.
-- Re-running the cron with the same window produces a new run_id; old
-- runs stay around for trend comparison until a retention sweep
-- prunes them.

CREATE TYPE "rejection_cluster_proposal_target" AS ENUM (
  'playbook',
  'domain_config',
  'none'
);

CREATE TYPE "rejection_cluster_proposal_status" AS ENUM (
  'pending',
  'accepted',
  'dismissed',
  'actioned'
);

CREATE TABLE "rejection_cluster_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "lookback_days" integer NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "rejection_count" integer NOT NULL DEFAULT 0,
  "cluster_count" integer NOT NULL DEFAULT 0,
  "ai_model" text,
  "tokens_in" integer NOT NULL DEFAULT 0,
  "tokens_out" integer NOT NULL DEFAULT 0,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "rejection_cluster_runs_org_idx"
  ON "rejection_cluster_runs" ("organization_id", "created_at" DESC);

CREATE TABLE "rejection_clusters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "rejection_cluster_runs"("id") ON DELETE CASCADE,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "stage_name" text NOT NULL,
  "practice_area" text,
  "label" text NOT NULL,
  "summary" text NOT NULL,
  "member_count" integer NOT NULL,
  "representative_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "member_audit_log_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "proposal_target" "rejection_cluster_proposal_target" NOT NULL DEFAULT 'none',
  "proposed_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "proposal_status" "rejection_cluster_proposal_status" NOT NULL DEFAULT 'pending',
  "actioned_at" timestamp with time zone,
  "actioned_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actioned_payload" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "rejection_clusters_run_idx"
  ON "rejection_clusters" ("run_id");

CREATE INDEX "rejection_clusters_org_status_idx"
  ON "rejection_clusters" ("organization_id", "proposal_status", "created_at" DESC);

CREATE INDEX "rejection_clusters_stage_idx"
  ON "rejection_clusters" ("stage_name", "practice_area");
