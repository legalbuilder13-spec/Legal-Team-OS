import { sql } from 'drizzle-orm';
import {
  rejectionClusterRuns,
  rejectionClusters,
  organizations,
  type Db,
  type RepresentativeReason,
  type ProposedPayload,
} from '@legal/db';
import { env } from '../env.js';

// M1 — Rejection-reason mining. Reads audit_log entries from
// PR10 (analysis.stage_rejected + analysis.stage_escalated), groups
// them into themed clusters via the apps/ai /cluster-rejections skill,
// and writes one row per cluster to rejection_clusters. The admin
// /admin/rejection-themes page renders pending clusters as a proposal
// queue. See PRD §20 + M1 plan in repo history.
//
// This is a low-frequency operation (weekly cron). The signal density
// only becomes useful after a few weeks of post-shadow data, so the
// handler short-circuits when there are <2 rejections in the window —
// no LLM cost on cold-start deployments.

const MIN_REJECTIONS_TO_CLUSTER = 2;
const MAX_REJECTIONS_PER_RUN = 200;

interface RejectionRow {
  audit_log_id: string;
  matter_id: string | null;
  stage_name: string;
  practice_area: string | null;
  worker_confidence: string | null;
  reason: string;
  decided_at: Date;
}

interface ClusterApiResponse {
  organization_id: string | null;
  rejection_count: number;
  clusters: Array<{
    stage_name: string;
    practice_area: string | null;
    label: string;
    summary: string;
    member_audit_log_ids: string[];
    representative_reasons: Array<{
      audit_log_id: string;
      matter_id: string | null;
      reason: string;
      worker_confidence: string | null;
      decided_at: string;
    }>;
    proposal_target: 'playbook' | 'domain_config' | 'none';
    proposed_payload: Record<string, unknown>;
  }>;
}

async function callClusterRejections(
  organizationId: string | null,
  rejections: RejectionRow[],
): Promise<ClusterApiResponse | null> {
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/cluster-rejections`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        organization_id: organizationId,
        rejections: rejections.map((r) => ({
          audit_log_id: r.audit_log_id,
          matter_id: r.matter_id,
          stage_name: r.stage_name,
          practice_area: r.practice_area,
          worker_confidence: r.worker_confidence,
          reason: r.reason,
          decided_at: r.decided_at.toISOString(),
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`cluster-rejections call failed: ${res.status} ${body.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as ClusterApiResponse;
  } catch (err) {
    console.warn('cluster-rejections call threw:', err);
    return null;
  }
}

export interface MineRejectionsResult {
  runId: string | null;
  organizationId: string | null;
  rejectionCount: number;
  clusterCount: number;
  skipped: 'no_rejections' | 'ai_unavailable' | null;
}

export async function runMineRejections(
  db: Db,
  options: { lookbackDays?: number; organizationId?: string | null } = {},
): Promise<MineRejectionsResult> {
  const lookbackDays = options.lookbackDays ?? 7;
  const organizationId = options.organizationId ?? null;
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const startedAt = Date.now();

  // Pull rejection + escalation events from audit_log. PR10 writes
  // these with action='analysis.stage_rejected' or 'analysis.stage_escalated'
  // and details carrying stage_name + worker_confidence + reason +
  // practice_area. Join to matters so we can scope by org once
  // multi-tenant scoping lands; today the join is informational.
  const rows = (await db.execute(sql`
    SELECT
      al.id::text AS audit_log_id,
      al.matter_id::text AS matter_id,
      (al.details->>'stage_name') AS stage_name,
      m.practice_area::text AS practice_area,
      (al.details->>'worker_confidence') AS worker_confidence,
      COALESCE(al.details->>'reason', '') AS reason,
      al.created_at AS decided_at
    FROM audit_log al
    LEFT JOIN matters m ON m.id = al.matter_id
    WHERE al.action IN ('analysis.stage_rejected', 'analysis.stage_escalated')
      AND al.created_at >= ${windowStart}
      AND al.created_at < ${windowEnd}
      AND COALESCE(al.details->>'reason', '') <> ''
    ORDER BY al.created_at DESC
    LIMIT ${MAX_REJECTIONS_PER_RUN}
  `)) as unknown as RejectionRow[];

  if (rows.length < MIN_REJECTIONS_TO_CLUSTER) {
    console.log(
      `mine-rejections: only ${rows.length} rejection(s) in last ${lookbackDays}d, skipping`,
    );
    return {
      runId: null,
      organizationId,
      rejectionCount: rows.length,
      clusterCount: 0,
      skipped: 'no_rejections',
    };
  }

  // Resolve the run's organization. Default org is the v1 singleton
  // (PR12); future PR splits by users.organization_id.
  let runOrgId: string | null = organizationId;
  if (runOrgId === null) {
    const defaultOrg = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`${organizations.slug} = 'default'`)
      .limit(1);
    runOrgId = defaultOrg[0]?.id ?? null;
  }

  const cluster = await callClusterRejections(runOrgId, rows);

  if (cluster === null) {
    const [run] = await db
      .insert(rejectionClusterRuns)
      .values({
        organizationId: runOrgId,
        lookbackDays,
        windowStart,
        windowEnd,
        rejectionCount: rows.length,
        clusterCount: 0,
        durationMs: Date.now() - startedAt,
        error: 'AI service unavailable',
      })
      .returning();
    return {
      runId: run?.id ?? null,
      organizationId: runOrgId,
      rejectionCount: rows.length,
      clusterCount: 0,
      skipped: 'ai_unavailable',
    };
  }

  const [run] = await db
    .insert(rejectionClusterRuns)
    .values({
      organizationId: runOrgId,
      lookbackDays,
      windowStart,
      windowEnd,
      rejectionCount: rows.length,
      clusterCount: cluster.clusters.length,
      durationMs: Date.now() - startedAt,
    })
    .returning();

  if (!run) throw new Error('rejection cluster run insert returned nothing');

  for (const c of cluster.clusters) {
    const representativeReasons: RepresentativeReason[] = c.representative_reasons.map((r) => ({
      audit_log_id: r.audit_log_id,
      matter_id: r.matter_id,
      reason: r.reason,
      worker_confidence: r.worker_confidence,
      decided_at: r.decided_at,
    }));
    await db.insert(rejectionClusters).values({
      runId: run.id,
      organizationId: runOrgId,
      stageName: c.stage_name,
      practiceArea: c.practice_area,
      label: c.label,
      summary: c.summary,
      memberCount: c.member_audit_log_ids.length,
      representativeReasons,
      memberAuditLogIds: c.member_audit_log_ids,
      proposalTarget: c.proposal_target,
      proposedPayload: c.proposed_payload as ProposedPayload,
    });
  }

  console.log(
    `mine-rejections: ${rows.length} rejections → ${cluster.clusters.length} clusters (run ${run.id})`,
  );
  return {
    runId: run.id,
    organizationId: runOrgId,
    rejectionCount: rows.length,
    clusterCount: cluster.clusters.length,
    skipped: null,
  };
}
