-- New enums for knowledge layer
CREATE TYPE "public"."insight_kind" AS ENUM (
  'volume_spike',
  'playbook_deviation',
  'workload_imbalance',
  'counterparty_pattern',
  'sla_trend',
  'self_service_opportunity'
);

CREATE TYPE "public"."insight_status" AS ENUM ('active', 'dismissed', 'actioned');

CREATE TYPE "public"."playbook_suggestion_status" AS ENUM ('pending', 'approved', 'rejected');

-- New job kinds for knowledge layer
ALTER TYPE "public"."job_kind" ADD VALUE 'enrich_counterparty_memory';
ALTER TYPE "public"."job_kind" ADD VALUE 'analyze_portfolio';

-- Add behavioral_profile to counterparties
ALTER TABLE "counterparties" ADD COLUMN "behavioral_profile" jsonb DEFAULT '{}'::jsonb;

-- Add version column to playbooks
ALTER TABLE "playbooks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;

-- Playbook versions (audit history)
CREATE TABLE "playbook_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playbook_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "change_summary" text,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "playbook_versions_playbook_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE,
  CONSTRAINT "playbook_versions_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
);

CREATE INDEX "playbook_versions_playbook_idx" ON "playbook_versions" ("playbook_id", "version_number");

-- Playbook suggestions (proposed updates from attorney feedback)
CREATE TABLE "playbook_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playbook_id" uuid,
  "practice_area" "practice_area" NOT NULL,
  "suggested_title" text NOT NULL,
  "suggested_body" text NOT NULL,
  "rationale" text NOT NULL,
  "evidence_matter_ids" jsonb DEFAULT '[]'::jsonb,
  "status" "playbook_suggestion_status" DEFAULT 'pending' NOT NULL,
  "proposed_by_id" uuid,
  "reviewed_by_id" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "playbook_suggestions_playbook_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE,
  CONSTRAINT "playbook_suggestions_proposed_by_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "users"("id"),
  CONSTRAINT "playbook_suggestions_reviewed_by_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
);

CREATE INDEX "playbook_suggestions_status_idx" ON "playbook_suggestions" ("status");

-- Knowledge articles (FAQ engine for self-service)
CREATE TABLE "knowledge_articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "practice_area" "practice_area" NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "view_count" integer DEFAULT 0 NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_articles_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
);

CREATE INDEX "knowledge_articles_practice_area_idx" ON "knowledge_articles" ("practice_area");
CREATE INDEX "knowledge_articles_active_idx" ON "knowledge_articles" ("is_active");

-- System insights (AI-suggested actions on dashboard)
CREATE TABLE "system_insights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" "insight_kind" NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "severity" text DEFAULT 'medium' NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb,
  "status" "insight_status" DEFAULT 'active' NOT NULL,
  "dismissed_by_id" uuid,
  "dismissed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_insights_dismissed_by_id_fk" FOREIGN KEY ("dismissed_by_id") REFERENCES "users"("id")
);

CREATE INDEX "system_insights_status_idx" ON "system_insights" ("status", "created_at");
