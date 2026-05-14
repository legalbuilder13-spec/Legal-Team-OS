import { z } from 'zod';

// Rule DSL backing PRD §12.1 NL configuration. Attorneys write rules in
// English; an LLM compiler emits the structured form below; a runtime
// evaluator runs the structured form against matter / clause inputs.
//
// Design notes:
// - Conditions are tree-structured: All / Any / Not / Leaf — covers
//   typical legal logic ('contract > $1M AND involves EU PII' etc).
// - Leaf comparisons reference matter / clause / counterparty fields by
//   dotted path. Operators are conservative — no full expression
//   language. If a rule can't be expressed in this DSL, the compiler
//   marks it `fallback_llm: true` and the runtime delegates to the LLM
//   at evaluation time.
// - Actions are kind-specific; the union below is the contract.

export const RuleKindSchema = z.enum(['sla', 'routing', 'triage', 'playbook_trigger']);
export type RuleKind = z.infer<typeof RuleKindSchema>;

export const RuleStatusSchema = z.enum(['draft', 'shadow', 'active', 'archived']);
export type RuleStatus = z.infer<typeof RuleStatusSchema>;

// ----- Condition tree -----

export const ConditionOpSchema = z.enum([
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'contains',
  'starts_with',
  'ends_with',
  'matches', // regex
  'in', // value in list
  'not_in',
  'exists',
  'is_empty',
]);
export type ConditionOp = z.infer<typeof ConditionOpSchema>;

const LeafCondition: z.ZodType<unknown> = z.object({
  field: z.string().min(1), // dotted path: 'matter.priority', 'counterparty.industry'
  op: ConditionOpSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
});

// Recursive condition tree.
export const ConditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    LeafCondition,
    z.object({ all: z.array(ConditionSchema) }),
    z.object({ any: z.array(ConditionSchema) }),
    z.object({ not: ConditionSchema }),
    z.object({ fallback_llm: z.literal(true), reason: z.string() }),
  ]),
);

export type Condition =
  | { field: string; op: ConditionOp; value?: string | number | boolean | Array<string | number> }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fallback_llm: true; reason: string };

// ----- Per-kind action payloads -----

export const SlaActionSchema = z.object({
  sla_hours: z.number().int().min(1).max(24 * 90),
  source: z.literal('rule').default('rule'),
});
export type SlaAction = z.infer<typeof SlaActionSchema>;

export const RoutingActionSchema = z.object({
  assignee_id: z.string().uuid().optional(),
  assignee_practice_area: z.string().optional(),
  sla_hours: z.number().int().min(1).max(24 * 90).optional(),
});
export type RoutingAction = z.infer<typeof RoutingActionSchema>;

export const TriageActionSchema = z.object({
  set_practice_area: z.string().optional(),
  set_priority: z.enum(['high', 'medium', 'low']).optional(),
  posture_override: z.string().optional(),
});
export type TriageAction = z.infer<typeof TriageActionSchema>;

export const PlaybookTriggerActionSchema = z.object({
  topic: z.string(),
  flag_severity: z.enum(['STANDARD', 'MODIFIED', 'FLAGGED']),
});
export type PlaybookTriggerAction = z.infer<typeof PlaybookTriggerActionSchema>;

// ----- Compiled rule envelope -----

export const CompiledRuleSchema = z.object({
  when: ConditionSchema,
  then: z.union([
    SlaActionSchema,
    RoutingActionSchema,
    TriageActionSchema,
    PlaybookTriggerActionSchema,
  ]),
  // If true, the runtime delegates evaluation to the LLM rather than the
  // deterministic evaluator. Set when the NL rule contains semantics the
  // compiler can't capture (e.g. 'matters that look like emergencies').
  fallback_llm: z.boolean().default(false),
});
export type CompiledRule = z.infer<typeof CompiledRuleSchema>;

// Scope: additional metadata constraining when the rule applies. Used by
// the evaluator to filter rules to the relevant subset before checking
// conditions. Empty scope means "applies everywhere of this kind."
export const RuleScopeSchema = z
  .object({
    practice_area: z.string().optional(),
    matter_type: z.string().optional(),
  })
  .default({});
export type RuleScope = z.infer<typeof RuleScopeSchema>;
