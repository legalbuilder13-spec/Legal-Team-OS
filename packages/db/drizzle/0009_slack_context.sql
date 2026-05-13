-- Stage 3 context source: Slack. Adds the per-source sub-job kind that
-- the context_fetch coordinator enqueues when a counterparty is known.
-- The handler uses the existing SLACK_BOT_TOKEN (already provisioned for
-- the /legal intake bot) — operator must add the search:read scope to
-- the existing app for this to function.

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'context_fetch_slack';
