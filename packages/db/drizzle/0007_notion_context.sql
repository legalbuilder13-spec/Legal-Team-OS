-- Stage 3 context source: Notion. Adds the per-source sub-job kind that
-- the context_fetch coordinator enqueues when a counterparty is known.
-- The handler searches the connected workspace for pages mentioning the
-- counterparty and writes an InsightCard into matters.context.notion.

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'context_fetch_notion';
