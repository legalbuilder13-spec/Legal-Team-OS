import { z } from 'zod';
import { ResearchDepthSchema } from './depth-policy.js';

// PRD §7 — Pre-review analysis pipeline. These schemas are the typed JSON
// contracts between the worker (TypeScript) and the AI skills (Python). The
// worker enforces schema on every skill response; malformed output fails
// closed and routes the matter to a lawyer rather than degrading silently.

export const AnalysisStatusSchema = z.enum([
  'pending',
  'running',
  'complete',
  'failed',
  'escalated',
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const AnalysisStageNameSchema = z.enum([
  'pre_merits',
  'guidance',
  'statutory',
  'case_law',
  'deconstruct',
]);
export type AnalysisStageName = z.infer<typeof AnalysisStageNameSchema>;

export const AnalysisStageStatusSchema = z.enum([
  'skipped',
  'running',
  'complete',
  'failed',
  'deferred',
]);
export type AnalysisStageStatus = z.infer<typeof AnalysisStageStatusSchema>;

export const AnalysisConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW', 'SPLIT', 'N_A']);
export type AnalysisConfidence = z.infer<typeof AnalysisConfidenceSchema>;

export const AnalysisSourceTypeSchema = z.enum([
  'notion',
  'statute',
  'regulation',
  'case',
  'guidance',
  'prior_matter',
  'webfetch',
]);
export type AnalysisSourceType = z.infer<typeof AnalysisSourceTypeSchema>;

export const AnalysisVerificationStatusSchema = z.enum([
  'pending',
  'verified',
  'minor_discrepancy',
  'material_discrepancy',
  'not_found',
  'unverifiable',
]);
export type AnalysisVerificationStatus = z.infer<typeof AnalysisVerificationStatusSchema>;

// ----- Stage 0: pre-merits threshold checklist -----
// PRD §7.5. The checklist itself is hardcoded per practice area; the skill
// reads the matter + checklist and returns a status per item.

export const ThresholdSeveritySchema = z.enum(['high', 'medium', 'low']);
export type ThresholdSeverity = z.infer<typeof ThresholdSeveritySchema>;

export const ThresholdItemSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  severityIfRaised: ThresholdSeveritySchema,
  docAnchor: z.string().optional(),
});
export type ThresholdItem = z.infer<typeof ThresholdItemSchema>;

export const ThresholdSpotterFindingSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['raised', 'not_raised', 'cant_tell']),
  confidence: z.number().min(0).max(1),
  evidenceQuote: z.string(),
  oneLineJustification: z.string(),
});
export type ThresholdSpotterFinding = z.infer<typeof ThresholdSpotterFindingSchema>;

export const PreMeritsStageOutputSchema = z.object({
  practiceArea: z.string(),
  checklistVersion: z.string(),
  findings: z.array(ThresholdSpotterFindingSchema),
  raisedHighSeverity: z.array(z.string()),
  notesForLawyer: z.string().optional(),
});
export type PreMeritsStageOutput = z.infer<typeof PreMeritsStageOutputSchema>;

// ----- Stage 1: guidance / playbook check -----
// PRD §7.5/§7.3. Searches the Notion-backed KB / playbooks / Saved Matters
// and grades each candidate for on-point-ness. The hardcoded gate then
// decides whether to "match" or escalate to lawyer.

export const GuidanceCandidateSchema = z.object({
  source: z.enum(['notion_playbook', 'notion_kb', 'notion_saved_matter']),
  title: z.string(),
  url: z.string().url().optional(),
  notionPageId: z.string().optional(),
  excerpt: z.string(),
  retrievedAt: z.string(),
});
export type GuidanceCandidate = z.infer<typeof GuidanceCandidateSchema>;

export const GuidanceGradeSchema = z.object({
  candidate: GuidanceCandidateSchema,
  onPointScore: z.number().min(0).max(1),
  jurisdictionMatch: z.boolean(),
  factPatternOverlap: z.number().min(0).max(1),
  ageConcern: z.boolean(),
  citationAnchor: z.string().nullable(),
  oneLineRationale: z.string(),
});
export type GuidanceGrade = z.infer<typeof GuidanceGradeSchema>;

export const GuidanceVerdictSchema = z.enum(['matched', 'related_only', 'no_hit']);
export type GuidanceVerdict = z.infer<typeof GuidanceVerdictSchema>;

export const GuidanceStageOutputSchema = z.object({
  verdict: GuidanceVerdictSchema,
  queriesRun: z.array(z.string()),
  grades: z.array(GuidanceGradeSchema),
  topMatch: GuidanceGradeSchema.nullable(),
  headlineAnswer: z
    .object({
      summary: z.string(),
      citation: z.string(),
      sourceUrl: z.string().url().optional(),
    })
    .nullable(),
  notesForLawyer: z.string().optional(),
});
export type GuidanceStageOutput = z.infer<typeof GuidanceStageOutputSchema>;

// ----- The on-point gating thresholds (hardcoded) -----
// PRD §7.5. These are the numeric thresholds the hardcoded gate uses to
// classify a guidance verdict. Tunable per organization in domain config.

export const GUIDANCE_MATCH_THRESHOLDS = {
  onPointScoreForMatch: 0.8,
  onPointScoreForRelated: 0.5,
  // Docs older than this lose match status even at high on-point score.
  maxAgeMonthsForMatch: 18,
} as const;

// ----- Tool invocation payloads (Phase 2+) -----
// PRD §7.6/§7.7/§12. Defined here so the web -> worker contract is stable
// even though the tool implementations land in later phases.

// PR7 — multi-jurisdiction. `jurisdictions` is the canonical input;
// `jurisdiction` (singular) is kept as a back-compat alias for clients
// that haven't been updated yet. Web router normalizes to the array.
export const StatutoryToolInvocationBaseSchema = z.object({
  matterId: z.string().uuid(),
  jurisdictions: z.array(z.string().min(1)).min(1).optional(),
  jurisdiction: z.string().min(1).optional(),
  // Free-text "what should the tool focus on" — e.g. "data breach
  // notification timing" or "wage garnishment exemptions". Optional;
  // when empty, the worker auto-extracts citations from the matter text
  // and runs the methodology on whatever it finds.
  subjectMatter: z.string().optional(),
  invokedByUserId: z.string().uuid(),
});
const jurisdictionRefine = [
  (v: { jurisdictions?: string[]; jurisdiction?: string }) =>
    Boolean(v.jurisdictions?.length || v.jurisdiction),
  'Must supply either jurisdictions[] or jurisdiction',
] as const;
export const StatutoryToolInvocationSchema = StatutoryToolInvocationBaseSchema.refine(
  jurisdictionRefine[0],
  jurisdictionRefine[1],
);
export type StatutoryToolInvocation = z.infer<typeof StatutoryToolInvocationSchema>;

// Helper used by both web and worker to normalize legacy single-
// jurisdiction calls to the array form.
export function normalizeJurisdictions(
  input: { jurisdictions?: string[]; jurisdiction?: string },
): string[] {
  if (input.jurisdictions && input.jurisdictions.length > 0) return input.jurisdictions;
  if (input.jurisdiction) return [input.jurisdiction];
  return [];
}

export const CaseLawToolInvocationSchema = z.object({
  matterId: z.string().uuid(),
  jurisdiction: z.string().min(1),
  // Free-text "what should the tool focus on" — e.g. "equitable
  // tolling under the FLSA" or "first-sale doctrine in software".
  // Optional; when empty, the worker builds the search query from
  // the matter title + summary alone.
  subjectMatter: z.string().optional(),
  // Optional anchor case for the 3rd retrieval strategy (citator
  // traversal — PRD §11.2). Lawyer supplies a CourtListener opinion
  // id when they have a known good anchor; the worker walks the
  // cited-by graph from there to discover siblings.
  anchorOpinionId: z.string().optional(),
  invokedByUserId: z.string().uuid(),
});
export type CaseLawToolInvocation = z.infer<typeof CaseLawToolInvocationSchema>;

export const DeconstructToolInvocationSchema = z.object({
  matterId: z.string().uuid(),
  invokedByUserId: z.string().uuid(),
});
export type DeconstructToolInvocation = z.infer<typeof DeconstructToolInvocationSchema>;

// Current pipeline version. Bumped when the stage contracts change so old
// matter_analyses rows can be identified as belonging to an older shape.
// PR-A bumped this to '1.1.0' — adds research_depth, doctrinal_frame,
// frame_flip_proposal, escalation_request fields across every stage.
export const PIPELINE_VERSION = '1.1.0';

// ----- PR-A — research depth + doctrinal-frame state -----
// Carried on every skill request so each stage can modulate behavior
// (depth) and propose Bayesian updates to the carried frame.

export { DEPTH_LABELS, DEPTH_DESCRIPTIONS, DEPTH_POLICY, depthPolicy } from './depth-policy.js';
export { ResearchDepthSchema };
export type { ResearchDepth, DepthPolicy } from './depth-policy.js';

// The frame state itself. Stored as jsonb on matter_analyses; pulled
// into every skill user-prompt so the model can reason about what
// regime is currently presumed to govern. Frame is intentionally
// open-vocabulary — a string label — because the doctrinal universe
// is too vast to enumerate. Examples: "ERISA_preempted",
// "state_common_law_contract", "UCC_Article_2", "FAA_arbitration",
// "title_VII_disparate_treatment", "section_1983_state_action".
export const DoctrinalFrameStateSchema = z.object({
  primary_regime: z.string().min(1),
  alternative_regimes: z
    .array(
      z.object({
        regime: z.string().min(1),
        prior: z.number().min(0).max(1),
      }),
    )
    .default([]),
  last_updated_by_stage: z.enum([
    'intake',
    'stage_0',
    'stage_1',
    'stage_2a',
    'stage_2b',
    'stage_3',
  ]),
  flip_count: z.number().int().min(0).default(0),
});
export type DoctrinalFrameState = z.infer<typeof DoctrinalFrameStateSchema>;

// Proposed frame revision produced by any skill that finds authority
// inconsistent with the carried frame (e.g., Stage 2a finds ERISA
// preempts the state-law claim Stage 0 flagged). Worker writes one
// row to matter_frame_flips; UI surfaces a banner with accept/reject.
export const FrameFlipProposalSchema = z.object({
  from_frame: z.string().nullable(),
  to_frame: z.string().min(1),
  evidence_quote: z.string().min(1),
  evidence_citation: z.string().optional(),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type FrameFlipProposal = z.infer<typeof FrameFlipProposalSchema>;

// Lawyer's decision on a proposed flip.
export const FrameFlipDecisionSchema = z.enum(['pending', 'accepted', 'rejected']);
export type FrameFlipDecision = z.infer<typeof FrameFlipDecisionSchema>;

// Stored row shape returned by the analysis router.
export const FrameFlipSchema = z.object({
  id: z.string().uuid(),
  matter_analysis_id: z.string().uuid(),
  proposed_by_stage: z.string(),
  from_frame: z.string().nullable(),
  to_frame: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  confidence: z.number().nullable(),
  lawyer_decision: FrameFlipDecisionSchema,
  lawyer_decided_at: z.string().nullable(),
  lawyer_decided_by_user_id: z.string().uuid().nullable(),
  created_at: z.string(),
});
export type FrameFlip = z.infer<typeof FrameFlipSchema>;

// Every skill receives + may emit these on its request and response
// envelopes. Worker is responsible for propagation; skills only read
// what they need.
export const PipelineContextSchema = z.object({
  research_depth: ResearchDepthSchema.default('client_advice'),
  doctrinal_frame: DoctrinalFrameStateSchema.nullable().default(null),
});
export type PipelineContext = z.infer<typeof PipelineContextSchema>;

// Optional emission on any skill response. Worker reads this off
// every stage and writes to matter_frame_flips when present.
export const SkillEnvelopeMixinSchema = z.object({
  frame_flip_proposal: FrameFlipProposalSchema.nullable().default(null),
});
export type SkillEnvelopeMixin = z.infer<typeof SkillEnvelopeMixinSchema>;

