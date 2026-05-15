import { eq } from 'drizzle-orm';
import {
  matterAnalyses,
  matters,
  auditLog,
  escalations,
  jobs,
  type Db,
  type Job,
} from '@legal/db';
import {
  PIPELINE_VERSION,
  detectSeniorReviewTriggers,
  type AnalysisConfidence,
} from '@legal/types';
import { env } from '../env.js';
import { runStage0 } from './analyze/stage-0-thresholds.js';
import { runStage1 } from './analyze/stage-1-guidance.js';
import { runAbsenceSpotter } from './analyze/absence-spotter.js';
import { persistEscalation } from './analyze/escalation.js';

// PRD §7 — pre-review analysis pipeline entry point.
// Auto pipeline only: Stage 0 (pre-merits checklist) + Stage 1 (playbook
// / guidance check). Lawyer-invoked research tools (Stage 2a statutory,
// 2b case-law, 3 deconstruct) are separate handlers wired in Phase 2+.

interface AnalyzePayload {
  matter_id: string;
  // PR-A — optional override of the default research_depth. When
  // omitted, the matter inherits the user's depth preference (currently
  // 'client_advice' globally). Pipeline-grade work and bet-the-company
  // requests must specify explicitly.
  research_depth?: 'quick_take' | 'client_advice' | 'filing_grade' | 'bet_the_company';
}

// PR-A — seed an initial doctrinal_frame at analysis creation time.
// The frame is a label, not an enum; we pick by practice area as a
// reasonable default. Stages can propose flips as they encounter
// authority that contradicts this initial guess.
function defaultFrameForPracticeArea(practiceArea: string | null): {
  primary_regime: string;
  alternative_regimes: Array<{ regime: string; prior: number }>;
  last_updated_by_stage: 'intake';
  flip_count: number;
} {
  const seedByArea: Record<string, string> = {
    commercial: 'state_common_law_contract',
    employment: 'title_VII_disparate_treatment',
    privacy: 'state_consumer_privacy_act',
    litigation: 'state_civil_procedure',
    corporate: 'delaware_general_corporation_law',
    regulatory: 'federal_administrative_law',
    ip: 'federal_intellectual_property',
    real_estate: 'state_real_property',
    other: 'unspecified',
  };
  return {
    primary_regime: seedByArea[practiceArea ?? 'other'] ?? 'unspecified',
    alternative_regimes: [],
    last_updated_by_stage: 'intake',
    flip_count: 0,
  };
}

export function pickWorseConfidence(
  a: AnalysisConfidence,
  b: AnalysisConfidence,
): AnalysisConfidence {
  // Rank order: LOW worst -> SPLIT -> MEDIUM -> HIGH best; N_A is neutral
  // (returns the other).
  const rank: Record<AnalysisConfidence, number> = {
    LOW: 0,
    SPLIT: 1,
    MEDIUM: 2,
    HIGH: 3,
    N_A: 4,
  };
  if (a === 'N_A') return b;
  if (b === 'N_A') return a;
  return rank[a] <= rank[b] ? a : b;
}

export async function handleAnalyzeJob(db: Db, job: Job) {
  // Feature gate. 'shadow' runs the pipeline but suppresses lawyer-facing
  // surfacing; 'true' surfaces normally; 'false' (default) no-ops.
  const mode = env.ANALYSIS_PIPELINE_ENABLED;
  if (mode === 'false') {
    console.log('analyze: ANALYSIS_PIPELINE_ENABLED=false, skipping');
    return;
  }
  const shadowMode = mode === 'shadow';

  const payload = job.payload as unknown as AnalyzePayload;
  const matter = await db.query.matters.findFirst({ where: eq(matters.id, payload.matter_id) });
  if (!matter) throw new Error(`matter ${payload.matter_id} not found`);
  if (matter.status === 'closed' || matter.status === 'cancelled') {
    console.log(`analyze: matter ${matter.shortId} is ${matter.status}, skipping`);
    return;
  }
  if (!matter.title || !matter.summary) {
    // Triage hasn't populated title/summary yet. Re-enqueue with a short
    // delay rather than racing — keeps the contract simple.
    await db.insert(jobs).values({
      kind: 'analyze',
      matterId: matter.id,
      payload: { matter_id: matter.id },
      runAt: new Date(Date.now() + 5000),
    });
    console.log(`analyze: matter ${matter.shortId} pre-triage, re-enqueued`);
    return;
  }

  // Senior-review trigger detection runs first — informs UI banner but
  // does NOT short-circuit the pipeline. PRD §14.2.
  const seniorTriggers = detectSeniorReviewTriggers(
    `${matter.requestText}\n${matter.title}\n${matter.summary ?? ''}`,
  );

  const [analysis] = await db
    .insert(matterAnalyses)
    .values({
      matterId: matter.id,
      pipelineVersion: PIPELINE_VERSION,
      status: 'running',
      startedAt: new Date(),
      // PR-A — seed depth + initial frame state.
      researchDepth: payload.research_depth ?? 'client_advice',
      doctrinalFrame: defaultFrameForPracticeArea(matter.practiceArea),
    })
    .returning({ id: matterAnalyses.id });
  const analysisId = analysis!.id;

  try {
    const stage0 = await runStage0(db, analysisId, matter);

    // PR-11 — skill-emitted escalation short-circuits the pipeline.
    // Stage 0 saw something that warrants raising the lawyer's hand
    // rather than letting downstream stages produce confident output
    // on a wrong premise.
    if (stage0.escalationRequest) {
      await persistEscalation(
        db,
        matter,
        analysisId,
        'stage_0',
        stage0.escalationRequest as Parameters<typeof persistEscalation>[4],
        shadowMode,
      );
      console.log(
        `analyze: matter ${matter.shortId} escalated by stage_0 (${stage0.escalationRequest.reason}); skipping downstream`,
      );
      return;
    }

    // PR-6 — absence spotter runs in parallel with Stage 1. Best-effort:
    // failure does not block the pipeline. Receives raised thresholds
    // so it can focus on facts adjacent to known issues.
    const [stage1, absenceResult] = await Promise.all([
      runStage1(db, analysisId, matter),
      runAbsenceSpotter(db, analysisId, matter, stage0.highSeverityRaised),
    ]);

    const overallConfidence = pickWorseConfidence(stage0.confidence, stage1.confidence);
    const matched = stage1.verdict === 'matched';
    const escalated = !matched;
    const escalationReason = (() => {
      if (matched) return null;
      if (stage1.verdict === 'related_only') return 'No on-point playbook hit; closest matches are related-only.';
      if (stage1.verdict === 'no_hit') return 'No on-point playbook hit; no related guidance found.';
      return 'Guidance stage did not complete cleanly; routed to lawyer for review.';
    })();

    await db
      .update(matterAnalyses)
      .set({
        status: escalated ? 'escalated' : 'complete',
        overallConfidence,
        escalationReason: escalationReason ?? undefined,
        completedAt: new Date(),
      })
      .where(eq(matterAnalyses.id, analysisId));

    // Audit log entry — mirrors the triage / context_fetch pattern.
    await db.insert(auditLog).values({
      actorKind: 'system',
      matterId: matter.id,
      action: 'matter.analyzed',
      details: {
        analysisId,
        pipelineVersion: PIPELINE_VERSION,
        stage0: { status: stage0.status, confidence: stage0.confidence },
        stage1: { status: stage1.status, confidence: stage1.confidence, verdict: stage1.verdict },
        overallConfidence,
        escalated,
        seniorReviewTriggers: seniorTriggers.map((t) => t.id),
        shadowMode,
        // PR-6 — OOD signal + absence-spotter counts for the trace.
        practiceAreaConfidence: stage0.practiceAreaConfidence,
        suggestedReroute: stage0.suggestedReroute,
        absenceFindings: absenceResult?.findings.length ?? 0,
      },
    });

    // Surface a senior-review escalation row if any critical triggers fired.
    if (seniorTriggers.some((t) => t.severity === 'critical')) {
      await db.insert(escalations).values({
        matterId: matter.id,
        kind: 'senior_review_required',
        severity: 'critical',
        title: `Senior review required for ${matter.shortId}`,
        body: [
          'Senior-review triggers fired on this matter before any research tool can be invoked.',
          '',
          ...seniorTriggers.map((t) => `- [${t.severity}] ${t.label} (${t.id})`),
        ].join('\n'),
        createdByKind: 'system',
        createdById: null,
        triggerRule: 'senior_review_trigger',
        evidence: { triggers: seniorTriggers.map((t) => ({ id: t.id, severity: t.severity })) },
      });
    }

    // Shadow mode: pipeline ran and rows are written, but no Slack
    // surfacing. Lawyers continue to work off the pre-pipeline UX while
    // we sample accuracy retrospectively.
    if (shadowMode) {
      console.log(`analyze: matter ${matter.shortId} shadow-mode complete, no surface`);
      return;
    }

    // Slack-notify payload extension — PRD §17.2. Auto-pipeline drops a
    // short summary into the existing notification stream so the lawyer
    // sees the analysis status next to the triage status.
    const matterUrl = `${env.WEB_APP_URL}/matters/${matter.id}`;
    const headlineAnswer =
      matched && 'headlineAnswer' in stage1.output ? stage1.output.headlineAnswer : null;
    const summary = headlineAnswer
      ? `Matched playbook · ${headlineAnswer.citation}\n${headlineAnswer.summary}`
      : `Needs lawyer review · ${escalationReason ?? 'no on-point guidance'}`;
    const highSeverityCount = stage0.highSeverityRaised.length;
    const flagsLine = highSeverityCount > 0
      ? `*Pre-merits flags:* ${highSeverityCount} high-severity (${stage0.highSeverityRaised.join(', ')})`
      : '*Pre-merits flags:* none';

    await db.insert(jobs).values({
      kind: 'slack_notify',
      matterId: matter.id,
      payload: {
        matter_id: matter.id,
        text: [
          `*${matter.shortId}* analysis · *${matched ? 'Matched' : 'Escalated'}*`,
          flagsLine,
          summary,
          matterUrl,
        ].join('\n'),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(matterAnalyses)
      .set({
        status: 'failed',
        escalationReason: `pipeline_error: ${msg.slice(0, 400)}`,
        completedAt: new Date(),
      })
      .where(eq(matterAnalyses.id, analysisId));
    await db.insert(auditLog).values({
      actorKind: 'system',
      matterId: matter.id,
      action: 'matter.analyze_failed',
      details: { analysisId, error: msg },
    });
    throw err;
  }
}
