import { z } from 'zod';

// PR-A — research_depth modulates how aggressively the analysis
// pipeline works. Centralized here so worker handlers, AI skills,
// and the UI all read from a single source of truth. When you add
// a new behavior that should vary by depth, add a column here
// rather than scattering `if (depth === 'bet_the_company')` checks
// across the codebase.

export const ResearchDepthSchema = z.enum([
  'quick_take',
  'client_advice',
  'filing_grade',
  'bet_the_company',
]);
export type ResearchDepth = z.infer<typeof ResearchDepthSchema>;

export const DEPTH_LABELS: Record<ResearchDepth, string> = {
  quick_take: 'Quick take',
  client_advice: 'Client advice',
  filing_grade: 'Filing-grade',
  bet_the_company: 'Bet-the-company',
};

export const DEPTH_DESCRIPTIONS: Record<ResearchDepth, string> = {
  quick_take:
    'Single-pass retrieval, no absence spotter, no ensemble. For Slack /legal lookups and quick triage.',
  client_advice:
    'Default. Three case-law strategies, absence spotter on, conditional multi-jurisdiction fanout.',
  filing_grade:
    'Citator expansion + multi-DB ensemble + mandatory verification pass. For work product that will be filed or sent to a client.',
  bet_the_company:
    'Two-hop citator, ensemble across every available source, absence spotter runs twice, no hedging on cost. Reserve for the matters that bet the company.',
};

export type DepthPolicy = {
  // Number of case-law retrieval strategies to run (1–3 + ensemble).
  caseLawStrategies: 1 | 2 | 3;
  // Whether to walk the CourtListener citing-references graph after
  // initial retrieval. 0 = off; 1 or 2 = hops.
  citatorExpansionHops: 0 | 1 | 2;
  // Whether to fan retrieval across multiple databases.
  ensembleRetrieval: boolean;
  // Whether to fan out parallel statutory runs for each jurisdiction.
  multiJurisdictionFanout: boolean | 'conditional';
  // Whether to invoke the absence spotter after Stage 0.
  absenceSpotter: 'off' | 'once' | 'twice';
  // Whether to run the verification-mode pass after Stage 2a/2b.
  verificationPass: boolean;
  // Hard cap on cross-reference resolution hops (PR-1, deferred).
  crossReferenceHopLimit: 0 | 1 | 2 | 3;
  // Max tokens to budget for the deconstruct (Stage 3) call.
  deconstructMaxTokens: number;
  // Whether the skill should default to hedged language in
  // confidence_basis when no clear signal exists.
  hedgeWhenAmbiguous: boolean;
};

export const DEPTH_POLICY: Record<ResearchDepth, DepthPolicy> = {
  quick_take: {
    caseLawStrategies: 1,
    citatorExpansionHops: 0,
    ensembleRetrieval: false,
    multiJurisdictionFanout: false,
    absenceSpotter: 'off',
    verificationPass: false,
    crossReferenceHopLimit: 1,
    deconstructMaxTokens: 2048,
    hedgeWhenAmbiguous: true,
  },
  client_advice: {
    caseLawStrategies: 3,
    citatorExpansionHops: 0,
    ensembleRetrieval: false,
    multiJurisdictionFanout: 'conditional',
    absenceSpotter: 'once',
    verificationPass: false,
    crossReferenceHopLimit: 2,
    deconstructMaxTokens: 3072,
    hedgeWhenAmbiguous: true,
  },
  filing_grade: {
    caseLawStrategies: 3,
    citatorExpansionHops: 1,
    ensembleRetrieval: true,
    multiJurisdictionFanout: true,
    absenceSpotter: 'once',
    verificationPass: true,
    crossReferenceHopLimit: 3,
    deconstructMaxTokens: 4096,
    hedgeWhenAmbiguous: false,
  },
  bet_the_company: {
    caseLawStrategies: 3,
    citatorExpansionHops: 2,
    ensembleRetrieval: true,
    multiJurisdictionFanout: true,
    absenceSpotter: 'twice',
    verificationPass: true,
    crossReferenceHopLimit: 3,
    deconstructMaxTokens: 4096,
    hedgeWhenAmbiguous: false,
  },
};

export function depthPolicy(depth: ResearchDepth): DepthPolicy {
  return DEPTH_POLICY[depth];
}
