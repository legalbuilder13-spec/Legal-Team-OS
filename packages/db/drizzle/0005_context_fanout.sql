-- Stage 3 parallel context fan-out: split the monolithic context_fetch job
-- into per-source sub-jobs so slow sources never block fast ones, and so
-- new sources (notion, slack, drive, etc.) can plug in without modifying
-- the coordinator. The original context_fetch job kind becomes the
-- coordinator that enqueues sub-jobs and returns immediately.

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'context_fetch_salesforce';
ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'context_fetch_similar_matters';
