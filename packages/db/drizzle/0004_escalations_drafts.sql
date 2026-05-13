-- Escalations: SLA breaches, playbook-triggered, manually flagged matters.

CREATE TYPE "escalation_status" AS ENUM ('open', 'acknowledged', 'resolved');
CREATE TYPE "escalation_severity" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE "escalations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "matter_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "severity" "escalation_severity" NOT NULL DEFAULT 'medium',
  "title" text NOT NULL,
  "body" text NOT NULL,
  "status" "escalation_status" NOT NULL DEFAULT 'open',
  "created_by_kind" text NOT NULL DEFAULT 'system',
  "created_by_id" uuid,
  "acknowledged_by_id" uuid,
  "acknowledged_at" timestamp with time zone,
  "resolved_by_id" uuid,
  "resolved_at" timestamp with time zone,
  "resolution_note" text,
  "trigger_rule" text,
  "evidence" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "escalations_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE CASCADE,
  CONSTRAINT "escalations_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id"),
  CONSTRAINT "escalations_acknowledged_by_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id"),
  CONSTRAINT "escalations_resolved_by_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id")
);

CREATE INDEX "escalations_status_idx" ON "escalations" ("status", "created_at");
CREATE INDEX "escalations_matter_idx" ON "escalations" ("matter_id");

-- Drafting workspace: one current draft per matter + version snapshots.

CREATE TABLE "matter_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "matter_id" uuid NOT NULL,
  "title" text NOT NULL DEFAULT 'Draft',
  "body" text NOT NULL DEFAULT '',
  "source_document" text,
  "version" integer NOT NULL DEFAULT 1,
  "created_by_id" uuid,
  "updated_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_drafts_matter_id_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE CASCADE,
  CONSTRAINT "matter_drafts_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id"),
  CONSTRAINT "matter_drafts_updated_by_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
);

CREATE UNIQUE INDEX "matter_drafts_matter_idx" ON "matter_drafts" ("matter_id");

CREATE TABLE "matter_draft_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "change_summary" text,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_draft_versions_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "matter_drafts"("id") ON DELETE CASCADE,
  CONSTRAINT "matter_draft_versions_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
);

CREATE INDEX "matter_draft_versions_draft_idx" ON "matter_draft_versions" ("draft_id", "version_number");
