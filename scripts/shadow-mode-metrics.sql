-- shadow-mode-metrics.sql
-- Run against the production DB after the shadow-mode rollout has
-- been running for at least 24-72h. Produces the launch-gate metrics
-- from PRD-Analysis-Pipeline.md §20.1.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/shadow-mode-metrics.sql
--
-- The four rows printed map to the launch gates:
--   1. matched_rate       — % of analyzed matters where Stage 1 matched a playbook.
--                           Want > 20%; below that, the relevance grader is too strict.
--   2. low_confidence_pct — % where overall confidence ended up LOW.
--                           Want < 30%; above that, something's wrong upstream.
--   3. p50_duration_ms    — median end-to-end pipeline time. Should be < 60s.
--   4. stage_failure_rate — % of stage rows that failed. Want < 5%.
--
-- The override-rate gate (< 15% on matched verdicts) requires a
-- separate signal — the override mutations from the lawyer toolbar
-- aren't audit-logged yet. Track manually from matter_notes for now.

\echo '=== Shadow-mode launch metrics ==='
\echo ''

\echo '1. Matched-rate by practice area (want > 20% across the board):'
SELECT
  m.practice_area,
  COUNT(*) FILTER (WHERE ma.status IN ('complete', 'escalated'))                AS analyzed,
  COUNT(*) FILTER (WHERE ma.status = 'complete')                                AS matched,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE ma.status = 'complete')
    / NULLIF(COUNT(*) FILTER (WHERE ma.status IN ('complete', 'escalated')), 0),
    1
  ) AS matched_pct
FROM matter_analyses ma
JOIN matters m ON m.id = ma.matter_id
WHERE ma.created_at > now() - interval '7 days'
GROUP BY m.practice_area
ORDER BY analyzed DESC;

\echo ''
\echo '2. LOW-confidence rate (want < 30%):'
SELECT
  COUNT(*)                                                                       AS total,
  COUNT(*) FILTER (WHERE overall_confidence = 'LOW')                             AS low,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE overall_confidence = 'LOW') / NULLIF(COUNT(*), 0),
    1
  ) AS low_pct
FROM matter_analyses
WHERE created_at > now() - interval '7 days'
  AND status IN ('complete', 'escalated');

\echo ''
\echo '3. End-to-end pipeline latency (want p50 < 60s):'
SELECT
  COUNT(*)                                                                       AS samples,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))) AS p50_seconds,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))) AS p95_seconds
FROM matter_analyses
WHERE created_at > now() - interval '7 days'
  AND completed_at IS NOT NULL
  AND started_at IS NOT NULL;

\echo ''
\echo '4. Stage failure rate (want < 5%):'
SELECT
  stage_name,
  COUNT(*)                                                                       AS total,
  COUNT(*) FILTER (WHERE status = 'failed')                                      AS failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'failed') / NULLIF(COUNT(*), 0),
    1
  ) AS failure_pct
FROM matter_analysis_stages
WHERE created_at > now() - interval '7 days'
GROUP BY stage_name
ORDER BY total DESC;

\echo ''
\echo '5. Verification-status breakdown (PRD §9):'
SELECT
  verification_status,
  COUNT(*) AS rows
FROM matter_analysis_sources
WHERE created_at > now() - interval '7 days'
GROUP BY verification_status
ORDER BY rows DESC;
