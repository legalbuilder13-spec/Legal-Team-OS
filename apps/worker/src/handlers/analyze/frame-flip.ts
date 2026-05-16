import { eq } from 'drizzle-orm';
import { matterAnalyses, matterFrameFlips, type Db } from '@legal/db';

// PR-A — shared helpers for the pipeline context (research_depth +
// doctrinal_frame). Each stage runner / tool handler:
//   1. Calls loadPipelineContext() to get { research_depth, doctrinal_frame }
//      to attach to the skill request envelope.
//   2. On skill response, calls persistFrameFlipProposal() with the
//      stage label + any frame_flip_proposal the skill emitted. The
//      proposal lands in matter_frame_flips with status=pending; the
//      UI surfaces a banner the lawyer accepts or rejects via the
//      analysis router.

export type DoctrinalFrameState = {
  primary_regime: string;
  alternative_regimes: Array<{ regime: string; prior: number }>;
  last_updated_by_stage: 'intake' | 'stage_0' | 'stage_1' | 'stage_2a' | 'stage_2b' | 'stage_3';
  flip_count: number;
};

export type FrameFlipProposal = {
  from_frame: string | null;
  to_frame: string;
  evidence_quote: string;
  evidence_citation?: string | null;
  rationale: string;
  confidence: number;
};

export type ResearchDepth = 'quick_take' | 'client_advice' | 'filing_grade' | 'bet_the_company';

export type PipelineContextEnvelope = {
  research_depth: ResearchDepth;
  doctrinal_frame: DoctrinalFrameState | null;
};

export async function loadPipelineContext(
  db: Db,
  analysisId: string,
): Promise<PipelineContextEnvelope> {
  const row = await db.query.matterAnalyses.findFirst({
    where: eq(matterAnalyses.id, analysisId),
  });
  if (!row) {
    return { research_depth: 'client_advice', doctrinal_frame: null };
  }
  return {
    research_depth: (row.researchDepth ?? 'client_advice') as ResearchDepth,
    doctrinal_frame: (row.doctrinalFrame ?? null) as DoctrinalFrameState | null,
  };
}

export async function persistFrameFlipProposal(
  db: Db,
  analysisId: string,
  proposedByStage: string,
  proposal: FrameFlipProposal | null | undefined,
): Promise<void> {
  if (!proposal) return;
  await db.insert(matterFrameFlips).values({
    matterAnalysisId: analysisId,
    proposedByStage,
    fromFrame: proposal.from_frame ?? null,
    toFrame: proposal.to_frame,
    evidence: {
      evidence_quote: proposal.evidence_quote,
      evidence_citation: proposal.evidence_citation ?? null,
      rationale: proposal.rationale,
    },
    confidence: proposal.confidence.toFixed(2),
  });
}
