import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  matterAnalysisStages,
  matterAnalyses,
  matters,
  users,
  playbooks,
  auditLog,
  type Db,
} from '@legal/db';
import { env } from '../env.js';

// M6 — Daily nudge cycle. Surfaces "you could have saved this as a
// playbook" learning opportunities. Finds accepted statutory /
// case_law / deconstruct stages from the last 7 days that:
//   - have not been saved as a playbook (no playbook with the same
//     title or no created_from_stage event referencing the stage)
//   - have HIGH or MEDIUM worker confidence (LOW outputs aren't
//     eligible per PR15 gate)
//   - would have matched ≥2 OTHER recent matters by counterfactual
//     similarity (proxy: same practice_area + tsvector match)
//
// Sends an admin a Slack DM listing the top N candidates with deep
// links. Closes the loop opened by M4 (tier promotion) with active
// surfacing.

const ELIGIBLE_STAGES = ['statutory', 'case_law', 'deconstruct'] as const;
const NUDGE_LOOKBACK_DAYS = 7;
const NUDGE_MIN_MATCHED_OTHER_MATTERS = 2;

interface CandidateRow {
  stage_id: string;
  matter_id: string;
  matter_short_id: string;
  matter_title: string;
  stage_name: string;
  practice_area: string | null;
  confidence: string;
  decided_at: Date;
  counterfactual_matches: number;
}

async function sendNudgeDm(slackUserId: string, text: string): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) {
    console.warn('SLACK_BOT_TOKEN not set — nudge DM skipped');
    return;
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel: slackUserId, text }),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(`nudge DM failed: ${body.error}`);
}

function renderNudgeMessage(rows: CandidateRow[]): string {
  const lines: string[] = [
    '*Memory nudge — accepted stages you could promote to playbooks.*',
    '',
    `${rows.length} stage${rows.length === 1 ? '' : 's'} from the last ${NUDGE_LOOKBACK_DAYS} days look like they'd benefit future similar matters.`,
    '',
  ];
  for (const r of rows.slice(0, 5)) {
    const url = `${env.WEB_APP_URL}/matters/${r.matter_id}`;
    lines.push(
      `• <${url}|${r.matter_short_id}> ${r.matter_title} — ${r.stage_name} (${r.confidence}) · ~${r.counterfactual_matches} counterfactual matches`,
    );
  }
  if (rows.length > 5) {
    lines.push(`  …and ${rows.length - 5} more.`);
  }
  lines.push('');
  lines.push(
    `Open the matter detail page → click "Save as playbook…" on the accepted stage to lock it in.`,
  );
  return lines.join('\n');
}

export interface NudgeMissedPlaybooksResult {
  scanned: number;
  candidates: number;
  dmsSent: number;
  skipped: 'no_candidates' | 'no_admins' | 'no_slack' | null;
}

export async function runNudgeMissedPlaybooks(db: Db): Promise<NudgeMissedPlaybooksResult> {
  const since = new Date(Date.now() - NUDGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // 1. Accepted, eligible-stage, HIGH/MEDIUM confidence stages from
  //    the window.
  const candidates = await db
    .select({
      id: matterAnalysisStages.id,
      stageName: matterAnalysisStages.stageName,
      confidence: matterAnalysisStages.confidence,
      decidedAt: matterAnalysisStages.lawyerDecidedAt,
      analysisId: matterAnalysisStages.analysisId,
    })
    .from(matterAnalysisStages)
    .where(
      and(
        eq(matterAnalysisStages.lawyerDecision, 'accepted'),
        sql`${matterAnalysisStages.confidence} IN ('HIGH', 'MEDIUM')`,
        sql`${matterAnalysisStages.stageName} = ANY(${[...ELIGIBLE_STAGES]}::analysis_stage_name[])`,
        isNotNull(matterAnalysisStages.lawyerDecidedAt),
        sql`${matterAnalysisStages.lawyerDecidedAt} >= ${since}`,
      ),
    )
    .orderBy(desc(matterAnalysisStages.lawyerDecidedAt))
    .limit(50);

  if (candidates.length === 0) {
    return { scanned: 0, candidates: 0, dmsSent: 0, skipped: 'no_candidates' };
  }

  // 2. Filter out stages that already produced a playbook (PR15
  //    audit event 'playbook.created_from_stage').
  const stageIds = candidates.map((c) => c.id);
  const alreadyPromoted = (await db.execute(sql`
    SELECT DISTINCT (details->>'stageId')::text AS stage_id
    FROM audit_log
    WHERE action = 'playbook.created_from_stage'
      AND (details->>'stageId') = ANY(${stageIds}::text[])
  `)) as unknown as Array<{ stage_id: string }>;
  const promotedSet = new Set(alreadyPromoted.map((r) => r.stage_id));
  const unpromoted = candidates.filter((c) => !promotedSet.has(c.id));
  if (unpromoted.length === 0) {
    return {
      scanned: candidates.length,
      candidates: 0,
      dmsSent: 0,
      skipped: 'no_candidates',
    };
  }

  // 3. Resolve matter context for each unpromoted candidate.
  const analysisIds = Array.from(new Set(unpromoted.map((c) => c.analysisId)));
  const analyses = await db
    .select({ id: matterAnalyses.id, matterId: matterAnalyses.matterId })
    .from(matterAnalyses)
    .where(sql`${matterAnalyses.id} = ANY(${analysisIds}::uuid[])`);
  const matterByAnalysis = new Map(analyses.map((a) => [a.id, a.matterId]));
  const matterIds = Array.from(new Set(analyses.map((a) => a.matterId)));
  const matterRows = await db
    .select({
      id: matters.id,
      shortId: matters.shortId,
      title: matters.title,
      practiceArea: matters.practiceArea,
      requestText: matters.requestText,
    })
    .from(matters)
    .where(sql`${matters.id} = ANY(${matterIds}::uuid[])`);
  const matterById = new Map(matterRows.map((m) => [m.id, m]));

  // 4. Counterfactual-match check: for each candidate, count OTHER
  //    matters in the same practice_area with tsvector overlap on
  //    request_text. Cheap proxy for "would this playbook have
  //    helped." Only candidates with >= NUDGE_MIN_MATCHED_OTHER_MATTERS
  //    are nudged.
  const enriched: CandidateRow[] = [];
  for (const c of unpromoted) {
    const matterId = matterByAnalysis.get(c.analysisId);
    if (!matterId) continue;
    const m = matterById.get(matterId);
    if (!m) continue;
    const queryText = (m.requestText ?? '').slice(0, 300);
    if (!queryText) continue;

    const matchRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM matters
      WHERE id != ${m.id}::uuid
        AND practice_area = ${m.practiceArea}::practice_area
        AND status != 'cancelled'
        AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(request_text, ''))
            @@ plainto_tsquery('english', ${queryText})
        AND created_at > now() - interval '60 days'
    `)) as unknown as Array<{ cnt: number }>;
    const counterfactual = matchRows[0]?.cnt ?? 0;
    if (counterfactual < NUDGE_MIN_MATCHED_OTHER_MATTERS) continue;
    if (!c.decidedAt) continue;

    enriched.push({
      stage_id: c.id,
      matter_id: m.id,
      matter_short_id: m.shortId,
      matter_title: m.title,
      stage_name: c.stageName,
      practice_area: m.practiceArea,
      confidence: c.confidence,
      decided_at: c.decidedAt,
      counterfactual_matches: counterfactual,
    });
    // Cap to top 10 for the nudge.
    if (enriched.length >= 10) break;
  }

  if (enriched.length === 0) {
    return {
      scanned: candidates.length,
      candidates: 0,
      dmsSent: 0,
      skipped: 'no_candidates',
    };
  }

  // 5. Resolve target admins (any admin user with a slack_user_id).
  const admins = await db
    .select({ id: users.id, email: users.email, slackUserId: users.slackUserId })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNotNull(users.slackUserId)));

  if (admins.length === 0) {
    return {
      scanned: candidates.length,
      candidates: enriched.length,
      dmsSent: 0,
      skipped: 'no_admins',
    };
  }
  if (!env.SLACK_BOT_TOKEN) {
    return {
      scanned: candidates.length,
      candidates: enriched.length,
      dmsSent: 0,
      skipped: 'no_slack',
    };
  }

  const message = renderNudgeMessage(enriched);
  let dmsSent = 0;
  for (const a of admins) {
    if (!a.slackUserId) continue;
    try {
      await sendNudgeDm(a.slackUserId, message);
      dmsSent += 1;
    } catch (err) {
      console.error(`nudge DM failed for ${a.email}:`, err);
    }
  }

  await db.insert(auditLog).values({
    actorKind: 'system',
    action: 'memory.nudge_sent',
    details: {
      candidate_count: enriched.length,
      dms_sent: dmsSent,
      stage_ids: enriched.map((e) => e.stage_id),
    },
  });

  // Bonus: also expose the candidate list via a small read-side
  // method (used by /admin/analysis-metrics banner). The audit_log
  // row above serves as the durable record.
  return {
    scanned: candidates.length,
    candidates: enriched.length,
    dmsSent,
    skipped: null,
  };
}

// Read-only counterpart for the metrics dashboard: count recent
// memory.nudge_sent events. Surfaced as the "Nudges this week" stat.
export async function getRecentNudgeStats(
  db: Db,
  lookbackDays: number = 7,
): Promise<{ runsLastWindow: number; candidatesLastWindow: number; dmsLastWindow: number }> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const rows = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS runs,
      COALESCE(SUM((details->>'candidate_count')::int), 0)::int AS candidates,
      COALESCE(SUM((details->>'dms_sent')::int), 0)::int AS dms
    FROM audit_log
    WHERE action = 'memory.nudge_sent'
      AND created_at >= ${since}
  `)) as unknown as Array<{ runs: number; candidates: number; dms: number }>;
  return {
    runsLastWindow: rows[0]?.runs ?? 0,
    candidatesLastWindow: rows[0]?.candidates ?? 0,
    dmsLastWindow: rows[0]?.dms ?? 0,
  };
}
