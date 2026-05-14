import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { adminProcedure, router } from '../trpc.js';

// PR14 — admin metrics dashboard. Returns the four launch-gate
// metrics from PRD §20.1 + shadow-mode-metrics.sql so admins can
// evaluate the pipeline without dropping into psql. Queries are
// parameterized by lookback window (default 7 days).

const WindowInput = z.object({
  lookbackDays: z.number().int().min(1).max(90).default(7),
});

export interface MatchedRateRow {
  practice_area: string | null;
  analyzed: number;
  matched: number;
  matched_pct: number | null;
}

export interface ConfidenceRow {
  total: number;
  low: number;
  low_pct: number | null;
}

export interface LatencyRow {
  samples: number;
  p50_seconds: number | null;
  p95_seconds: number | null;
}

export interface StageFailureRow {
  stage_name: string;
  total: number;
  failed: number;
  failure_pct: number | null;
}

export interface VerificationRow {
  verification_status: string;
  count: number;
}

export interface OverrideRow {
  stage_name: string;
  decided: number;
  accepted: number;
  rejected: number;
  escalated: number;
  override_pct: number | null;
}

export interface PlaybookTierRow {
  tier: 'draft' | 'org' | 'industry';
  count: number;
}

export const analysisMetricsRouter = router({
  summary: adminProcedure.input(WindowInput).query(async ({ ctx, input }) => {
    const days = input.lookbackDays;
    const interval = sql.raw(`'${days} days'`);

    // 1. Matched-rate per practice area
    const matchedRate = (await ctx.db.execute(sql`
      SELECT m.practice_area::text AS practice_area,
        COUNT(*) FILTER (WHERE ma.status IN ('complete', 'escalated'))::int AS analyzed,
        COUNT(*) FILTER (WHERE ma.status = 'complete')::int AS matched,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE ma.status = 'complete')
          / NULLIF(COUNT(*) FILTER (WHERE ma.status IN ('complete', 'escalated')), 0),
          1
        )::float AS matched_pct
      FROM matter_analyses ma
      JOIN matters m ON m.id = ma.matter_id
      WHERE ma.created_at > now() - interval ${interval}
      GROUP BY m.practice_area
      ORDER BY analyzed DESC
    `)) as unknown as MatchedRateRow[];

    // 2. LOW-confidence rate
    const lowConfidenceRows = (await ctx.db.execute(sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE overall_confidence = 'LOW')::int AS low,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE overall_confidence = 'LOW') / NULLIF(COUNT(*), 0),
          1
        )::float AS low_pct
      FROM matter_analyses
      WHERE created_at > now() - interval ${interval}
        AND status IN ('complete', 'escalated')
    `)) as unknown as ConfidenceRow[];

    // 3. End-to-end latency (p50 + p95)
    const latency = (await ctx.db.execute(sql`
      SELECT COUNT(*)::int AS samples,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))
        )::float AS p50_seconds,
        PERCENTILE_CONT(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))
        )::float AS p95_seconds
      FROM matter_analyses
      WHERE created_at > now() - interval ${interval}
        AND completed_at IS NOT NULL
        AND started_at IS NOT NULL
    `)) as unknown as LatencyRow[];

    // 4. Stage failure rate
    const stageFailures = (await ctx.db.execute(sql`
      SELECT stage_name::text AS stage_name,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'failed') / NULLIF(COUNT(*), 0),
          1
        )::float AS failure_pct
      FROM matter_analysis_stages
      WHERE created_at > now() - interval ${interval}
      GROUP BY stage_name
      ORDER BY total DESC
    `)) as unknown as StageFailureRow[];

    // 5. Verification-status breakdown
    const verificationStatus = (await ctx.db.execute(sql`
      SELECT verification_status::text AS verification_status,
        COUNT(*)::int AS count
      FROM matter_analysis_sources
      WHERE created_at > now() - interval ${interval}
      GROUP BY verification_status
      ORDER BY count DESC
    `)) as unknown as VerificationRow[];

    // 6. Lawyer override rate (post-PR10; null when no decisions
    //    recorded yet)
    const overrideRate = (await ctx.db.execute(sql`
      SELECT stage_name::text AS stage_name,
        COUNT(*) FILTER (WHERE lawyer_decision != 'pending')::int AS decided,
        COUNT(*) FILTER (WHERE lawyer_decision = 'accepted')::int AS accepted,
        COUNT(*) FILTER (WHERE lawyer_decision = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE lawyer_decision = 'escalated')::int AS escalated,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE lawyer_decision IN ('rejected', 'escalated'))
          / NULLIF(COUNT(*) FILTER (WHERE lawyer_decision != 'pending'), 0),
          1
        )::float AS override_pct
      FROM matter_analysis_stages
      WHERE created_at > now() - interval ${interval}
        AND confidence != 'LOW'
      GROUP BY stage_name
      ORDER BY stage_name
    `)) as unknown as OverrideRow[];

    // 7. M4 — Playbook canon tier distribution + recent transitions.
    const tierCounts = (await ctx.db.execute(sql`
      SELECT canon_tier::text AS tier, COUNT(*)::int AS count
      FROM playbooks
      GROUP BY canon_tier
    `)) as unknown as PlaybookTierRow[];
    const tierTransitions = (await ctx.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE action = 'playbook.promoted')::int AS promoted,
        COUNT(*) FILTER (WHERE action = 'playbook.demoted')::int AS demoted
      FROM audit_log
      WHERE action IN ('playbook.promoted', 'playbook.demoted')
        AND created_at > now() - interval ${interval}
    `)) as unknown as Array<{ promoted: number; demoted: number }>;

    return {
      window: { days },
      matchedRate,
      lowConfidence: lowConfidenceRows[0] ?? { total: 0, low: 0, low_pct: 0 },
      latency: latency[0] ?? { samples: 0, p50_seconds: null, p95_seconds: null },
      stageFailures,
      verificationStatus,
      overrideRate,
      playbookTiers: {
        counts: tierCounts,
        promoted: tierTransitions[0]?.promoted ?? 0,
        demoted: tierTransitions[0]?.demoted ?? 0,
      },
    };
  }),
});
