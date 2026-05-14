import { z } from 'zod';

// PR12 §15 — per-organization domain configuration. Shape mirrors
// PRD-Analysis-Pipeline.md §15.1's domain_config.json example.
// Industry-specific behavior (terminology rules, jurisdiction risk,
// risk taxonomy, factual baseline) lives here per-organization
// rather than in code, so the same codebase can serve different
// in-house legal teams.

export const TerminologyRuleSchema = z.object({
  preferred: z.string().min(1),
  avoid: z.string().min(1),
  rationale: z.string().optional(),
});
export type TerminologyRule = z.infer<typeof TerminologyRuleSchema>;

export const VerbRuleSchema = z.object({
  prefer: z.string().min(1),
  avoid: z.string().min(1),
  context: z.string().optional(),
});
export type VerbRule = z.infer<typeof VerbRuleSchema>;

export const HighScrutinyJurisdictionSchema = z.object({
  jurisdiction: z.string().min(1),
  rationale: z.string().optional(),
  appliesToPracticeAreas: z.array(z.string()).default([]),
});
export type HighScrutinyJurisdiction = z.infer<typeof HighScrutinyJurisdictionSchema>;

export const DomainRiskCategorySchema = z.object({
  categoryId: z.string().min(1),
  label: z.string().min(1),
  examplesFlag: z.array(z.string()).default([]),
  defaultSeverity: z.enum(['high', 'medium', 'low']),
});
export type DomainRiskCategory = z.infer<typeof DomainRiskCategorySchema>;

export const EscalationThresholdsSchema = z
  .object({
    financialBetTheCompanyUsd: z.number().nonnegative().optional(),
    confidenceLowRouting: z
      .enum(['senior_reviewer', 'queue', 'requester_only'])
      .optional(),
  })
  .default({});
export type EscalationThresholds = z.infer<typeof EscalationThresholdsSchema>;

export const DomainConfigSchema = z.object({
  // Notion page id (or other KB pointer) that holds the org's
  // standing fact pattern. Skills don't fetch this directly; the
  // worker can pull excerpts into the prompt when relevant.
  factualBaselineKbPage: z.string().optional(),
  // Inline factual baseline facts injected into every research skill's
  // user prompt. Keep short — these are static premises about the org.
  factualBaselineFacts: z.array(z.string()).default([]),
  terminologyRules: z.array(TerminologyRuleSchema).default([]),
  verbRules: z.array(VerbRuleSchema).default([]),
  highScrutinyJurisdictions: z.array(HighScrutinyJurisdictionSchema).default([]),
  domainRiskTaxonomy: z.array(DomainRiskCategorySchema).default([]),
  preferredResearchDatabase: z
    .enum(['westlaw', 'lexis', 'fastcase', 'courtlistener', 'vlex', 'bloomberg', 'mixed'])
    .optional(),
  escalationThresholds: EscalationThresholdsSchema,
});
export type DomainConfig = z.infer<typeof DomainConfigSchema>;

// Empty config returned by the loader when an organization has no
// custom rules. All consumers must handle the empty case identically
// to a missing config — the system is fully functional without any
// per-org customization.
export const EMPTY_DOMAIN_CONFIG: DomainConfig = {
  factualBaselineFacts: [],
  terminologyRules: [],
  verbRules: [],
  highScrutinyJurisdictions: [],
  domainRiskTaxonomy: [],
  escalationThresholds: {},
};

// Returns true if the config has any content the skills should
// surface. Used to short-circuit prompt rendering when the config
// is empty (most pre-customization deployments).
export function hasDomainConfigContent(c: DomainConfig): boolean {
  return (
    c.factualBaselineFacts.length > 0 ||
    c.terminologyRules.length > 0 ||
    c.verbRules.length > 0 ||
    c.highScrutinyJurisdictions.length > 0 ||
    c.domainRiskTaxonomy.length > 0
  );
}
