-- Stage 3 context source: Google Drive. Adds the per-source sub-job kind
-- that the context_fetch coordinator enqueues when a counterparty is known.
-- Worker uses service-account JWT auth via Node's built-in crypto (no
-- googleapis SDK dependency).

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'context_fetch_drive';
