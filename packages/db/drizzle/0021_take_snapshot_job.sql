-- PR6 §9 — full screenshot-and-compare verification. Adds a new job
-- kind `take_snapshot` so the statutory + case-law tools can enqueue
-- async screenshot work after they complete. The handler navigates
-- via Playwright, captures a PNG to S3-compatible storage, updates
-- matter_analysis_sources.verification_evidence_url, and re-verifies
-- the source's raw_excerpt against the rendered page text.

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'take_snapshot';
