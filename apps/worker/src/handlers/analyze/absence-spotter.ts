import { matterAbsenceFindings, type Db, type Matter } from '@legal/db';
import { env } from '../../env.js';
import { loadOrgConfigForUser, domainConfigForSkill } from '../../integrations/org_config.js';
import {
  loadPipelineContext,
  persistFrameFlipProposal,
  type FrameFlipProposal,
} from './frame-flip.js';

// PR-6 — absence-spotter handler.
// Sibling to Stage 0; runs in parallel with Stage 1. Surfaces 3–5
// missing facts that would change the answer. Gated by depth-policy:
// 'quick_take' skips entirely; 'client_advice' + 'filing_grade' run
// once; 'bet_the_company' runs twice (initial + after Stage 2 results
// land, picking up missing facts that the research surfaced as
// material).

interface AbsenceFinding {
  missing_fact: string;
  why_dispositive: string;
  severity: 'high' | 'medium' | 'low';
  suggested_clarifying_question: string;
}

interface AbsenceSpotterResult {
  matter_id: string;
  findings: AbsenceFinding[];
  frame_flip_proposal?: FrameFlipProposal | null;
}

export async function runAbsenceSpotter(
  db: Db,
  analysisId: string,
  matter: Matter,
  raisedThresholds: string[],
): Promise<{ findings: AbsenceFinding[] } | null> {
  // PR #72 feature gate — default 'off' makes the merge inert.
  if (env.ANALYSIS_HLT_ENABLED !== 'on') return null;

  const context = await loadPipelineContext(db, analysisId);
  if (context.research_depth === 'quick_take') {
    // Depth-policy: absence spotter off at quick_take.
    return null;
  }

  const orgConfig = await loadOrgConfigForUser(db, matter.requesterId);
  const req = {
    matter_id: matter.id,
    practice_area: matter.practiceArea ?? 'other',
    request_text: matter.requestText,
    raised_thresholds: raisedThresholds,
    domain_config: domainConfigForSkill(orgConfig),
    context,
  };

  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/absence-spotter`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      console.warn(`absence-spotter ${res.status}: ${await res.text()}`);
      return null;
    }
    const raw = (await res.json()) as AbsenceSpotterResult;
    await persistFrameFlipProposal(db, analysisId, 'absence_spotter', raw.frame_flip_proposal);

    if (raw.findings.length === 0) return { findings: [] };

    await db.insert(matterAbsenceFindings).values(
      raw.findings.map((f) => ({
        matterAnalysisId: analysisId,
        missingFact: f.missing_fact,
        whyDispositive: f.why_dispositive,
        severity: f.severity,
        suggestedClarifyingQuestion: f.suggested_clarifying_question,
      })),
    );

    return { findings: raw.findings };
  } catch (err) {
    // Best-effort: absence spotter failure does NOT break the pipeline.
    // The lawyer still gets Stage 0/1 output; absences are a quality
    // enhancement, not a blocker.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`absence-spotter failed: ${msg}`);
    return null;
  }
}
