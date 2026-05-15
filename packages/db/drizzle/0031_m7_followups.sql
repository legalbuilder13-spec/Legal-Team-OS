-- M7 follow-ups (PR #59 → next): three pieces.
--
-- 1. On-close trigger — when a matter closes, web enqueues a
--    'mine_playbook_edits' job scoped to that matter. The worker
--    handler runs the same M7 logic in single-matter mode.
--
-- 2. Auto-apply to Notion — when admin accepts a proposal, web
--    enqueues 'apply_playbook_edit_to_notion'. Worker fetches the
--    playbook page and appends a callout block carrying the proposed
--    edit + attribution. Tracked on the proposal row via
--    notion_applied_at / notion_block_id / notion_apply_error.
--
-- 3. Slack DMs — a new daily cron looks for pending proposals not yet
--    DM'd and sends admins a Block Kit message with accept / dismiss
--    buttons. slack_dm_sent_at prevents re-DMing the same proposal
--    every day.

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'mine_playbook_edits';
ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'apply_playbook_edit_to_notion';

ALTER TABLE "playbook_edit_proposals"
  ADD COLUMN IF NOT EXISTS "notion_applied_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "notion_block_id" text,
  ADD COLUMN IF NOT EXISTS "notion_apply_error" text,
  ADD COLUMN IF NOT EXISTS "slack_dm_sent_at" timestamp with time zone;
