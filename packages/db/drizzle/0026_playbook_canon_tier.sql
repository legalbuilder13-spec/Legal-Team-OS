-- M4 — Playbook tiering. Promotes battle-tested playbooks to a
-- higher retrieval weight. Tier transitions are driven by usage
-- telemetry already captured in audit_log (PR8 + PR10):
--   draft  → org      : matched_count >= 5 AND accepted_when_matched / matched >= 0.8
--   org    → industry : reserved for cross-org promotion (future PR)
--   org    → draft    : ratio < 0.5 over last 10 matches (auto-demote)
--
-- The cron runs nightly. Stage 1 guidance grader weights org-tier
-- candidates higher in GUIDANCE_MATCH_THRESHOLDS.

CREATE TYPE "playbook_canon_tier" AS ENUM (
  'draft',
  'org',
  'industry'
);

ALTER TABLE "playbooks"
  ADD COLUMN "canon_tier" "playbook_canon_tier" NOT NULL DEFAULT 'draft',
  ADD COLUMN "matched_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "accepted_when_matched_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "last_promoted_at" timestamp with time zone,
  ADD COLUMN "last_demoted_at" timestamp with time zone,
  -- Allows the promote-playbooks cron to count matches by joining
  -- audit_log events (which carry the matched candidate's
  -- notion_page_id) to playbooks created via PR15 savePlaybookFromStage
  -- with alsoSaveToNotion=true. Nullable for playbooks created
  -- directly in /admin/playbooks without a Notion mirror.
  ADD COLUMN "notion_page_id" text;

CREATE INDEX "playbooks_notion_page_id_idx"
  ON "playbooks" ("notion_page_id") WHERE "notion_page_id" IS NOT NULL;

CREATE INDEX "playbooks_canon_tier_idx"
  ON "playbooks" ("canon_tier", "practice_area");
