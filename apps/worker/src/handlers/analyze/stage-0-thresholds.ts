import { eq } from 'drizzle-orm';
import { matterAnalysisStages, type Db, type Matter } from '@legal/db';
import {
  AnalysisConfidenceSchema,
  PreMeritsStageOutputSchema,
  getThresholdChecklist,
  type AnalysisConfidence,
  type PreMeritsStageOutput,
} from '@legal/types';
import { env } from '../../env.js';
import { hashContent } from './sources.js';

// PRD §7.5 — Stage 0 pre-merits threshold checklist.
// Hardcoded: per-practice-area checklist load + verdict computation +
// stage-row write. Skill: per-item finding judgment.

interface ThresholdSpotterRequest {
  matter_id: string;
  practice_area: string;
  request_text: string;
  checklist_version: string;
  items: Array<{
    id: string;
    prompt: string;
    severity_if_raised: 'high' | 'medium' | 'low';
    doc_anchor?: string;
  }>;
}

interface ThresholdSpotterResult {
  matter_id: string;
  practice_area: string;
  checklist_version: string;
  findings: Array<{
    id: string;
    status: 'raised' | 'not_raised' | 'cant_tell';
    confidence: number;
    evidence_quote: string;
    one_line_justification: string;
  }>;
}

export interface StageResult {
  stageId: string;
  status: 'complete' | 'failed' | 'skipped';
  confidence: AnalysisConfidence;
  output: PreMeritsStageOutput | { error: string };
  highSeverityRaised: string[];
}

export async function runStage0(
  db: Db,
  analysisId: string,
  matter: Matter,
): Promise<StageResult> {
  const practiceArea = matter.practiceArea ?? 'other';
  const checklist = getThresholdChecklist(practiceArea);

  const skillRequest: ThresholdSpotterRequest = {
    matter_id: matter.id,
    practice_area: practiceArea,
    request_text: matter.requestText,
    checklist_version: checklist.version,
    items: checklist.items.map((i) => ({
      id: i.id,
      prompt: i.prompt,
      severity_if_raised: i.severityIfRaised,
      doc_anchor: i.docAnchor,
    })),
  };
  const inputHash = hashContent(JSON.stringify(skillRequest));

  // Insert the stage row up front so a crash mid-call still leaves a
  // trace. Worker pattern matches the existing context-fetch handlers.
  const [stage] = await db
    .insert(matterAnalysisStages)
    .values({
      analysisId,
      stageName: 'pre_merits',
      status: 'running',
      inputHash,
      model: 'claude-opus-4-7',
    })
    .returning({ id: matterAnalysisStages.id });
  const stageId = stage!.id;

  const startedAt = Date.now();

  // Empty checklist (practice area without a curated list yet) — short
  // circuit, no skill call.
  if (checklist.items.length === 0) {
    const emptyOutput: PreMeritsStageOutput = {
      practiceArea,
      checklistVersion: checklist.version,
      findings: [],
      raisedHighSeverity: [],
      notesForLawyer: `No pre-merits checklist defined for practice_area=${practiceArea}; Stage 0 produced no findings.`,
    };
    await db
      .update(matterAnalysisStages)
      .set({
        status: 'skipped',
        outputJson: emptyOutput,
        confidence: 'N_A',
        durationMs: Date.now() - startedAt,
      })
      .where(eq(matterAnalysisStages.id, stageId));
    return {
      stageId,
      status: 'skipped',
      confidence: 'N_A',
      output: emptyOutput,
      highSeverityRaised: [],
    };
  }

  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/threshold-spotter`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify(skillRequest),
    });
    if (!res.ok) {
      throw new Error(`threshold-spotter ${res.status}: ${await res.text()}`);
    }
    const raw = (await res.json()) as ThresholdSpotterResult;

    // Look up severity per id from the checklist (the skill returns id +
    // status but not severity — severity is a hardcoded property).
    const severityById = new Map(checklist.items.map((i) => [i.id, i.severityIfRaised]));
    const findings = raw.findings.map((f) => ({
      id: f.id,
      status: f.status,
      confidence: f.confidence,
      evidenceQuote: f.evidence_quote,
      oneLineJustification: f.one_line_justification,
    }));
    const highSeverityRaised = findings
      .filter((f) => f.status === 'raised' && f.confidence >= 0.7 && severityById.get(f.id) === 'high')
      .map((f) => f.id);

    const output: PreMeritsStageOutput = {
      practiceArea,
      checklistVersion: checklist.version,
      findings,
      raisedHighSeverity: highSeverityRaised,
    };
    PreMeritsStageOutputSchema.parse(output);

    // Confidence: HIGH if no high-severity raised at >=0.7. MEDIUM if
    // there's a high-severity raised (the lawyer needs to look). LOW if
    // the skill returned >50% cant_tell — signals ambiguous request.
    const cantTellRatio =
      findings.length > 0 ? findings.filter((f) => f.status === 'cant_tell').length / findings.length : 0;
    let confidence: AnalysisConfidence = 'HIGH';
    if (cantTellRatio > 0.5) confidence = 'LOW';
    else if (highSeverityRaised.length > 0) confidence = 'MEDIUM';
    AnalysisConfidenceSchema.parse(confidence);

    await db
      .update(matterAnalysisStages)
      .set({
        status: 'complete',
        outputJson: output as unknown as Record<string, unknown>,
        confidence,
        durationMs: Date.now() - startedAt,
      })
      .where(eq(matterAnalysisStages.id, stageId));

    return { stageId, status: 'complete', confidence, output, highSeverityRaised };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(matterAnalysisStages)
      .set({
        status: 'failed',
        outputJson: { error: msg } as Record<string, unknown>,
        confidence: 'LOW',
        durationMs: Date.now() - startedAt,
        auditNotes: msg.slice(0, 4000),
      })
      .where(eq(matterAnalysisStages.id, stageId));
    return {
      stageId,
      status: 'failed',
      confidence: 'LOW',
      output: { error: msg },
      highSeverityRaised: [],
    };
  }
}
