-- M7 — Playbook edit proposals. After matter close, the worker looks
-- at playbooks that matched in Stage 1 and compares the playbook content
-- against the lawyer-accepted output for those matters. The AI service
-- proposes edits to the playbook; admins review on
-- /admin/playbook-edit-proposals and accept or dismiss.
--
-- Schema mirrors domain_config_proposals (0027): one row per proposed
-- edit, with rationale, evidence pointers, and an admin decision.
-- Gated by M7_ENABLED env var on the worker — when off, the cron
-- short-circuits and writes nothing.

CREATE TYPE "playbook_edit_proposal_status" AS ENUM (
  'pending',
  'accepted',
  'dismissed'
);

CREATE TABLE "playbook_edit_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playbook_id" uuid REFERENCES "playbooks"("id") ON DELETE CASCADE,
  "notion_page_id" text,
  "playbook_title" text NOT NULL,
  "section" text NOT NULL,
  "proposed_edit" text NOT NULL,
  "rationale" text NOT NULL,
  "evidence_matter_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "evidence_count" integer NOT NULL DEFAULT 1,
  "status" "playbook_edit_proposal_status" NOT NULL DEFAULT 'pending',
  "actioned_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actioned_at" timestamp with time zone,
  "actioned_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "playbook_edit_proposals_status_idx"
  ON "playbook_edit_proposals" ("status", "created_at" DESC);

CREATE INDEX "playbook_edit_proposals_playbook_idx"
  ON "playbook_edit_proposals" ("playbook_id", "status");
