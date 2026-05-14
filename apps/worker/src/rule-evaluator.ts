// Runtime evaluator for the rule DSL (PRD §12.1). Walks a compiled
// condition tree and returns true/false, falling back to LLM evaluation
// when a rule is flagged fallback_llm=true. Pure function — no DB or
// network calls (LLM fallback is wired separately when needed).

export type ConditionOp =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'matches'
  | 'in'
  | 'not_in'
  | 'exists'
  | 'is_empty';

export type Condition =
  | { field: string; op: ConditionOp; value?: unknown }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fallback_llm: true; reason: string };

function getField(obj: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

function compare(left: unknown, op: ConditionOp, right: unknown): boolean {
  switch (op) {
    case '==':
      // eslint-disable-next-line eqeqeq
      return left == right;
    case '!=':
      // eslint-disable-next-line eqeqeq
      return left != right;
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'contains':
      return typeof left === 'string' && typeof right === 'string' && left.toLowerCase().includes(right.toLowerCase());
    case 'starts_with':
      return typeof left === 'string' && typeof right === 'string' && left.toLowerCase().startsWith(right.toLowerCase());
    case 'ends_with':
      return typeof left === 'string' && typeof right === 'string' && left.toLowerCase().endsWith(right.toLowerCase());
    case 'matches':
      if (typeof left !== 'string' || typeof right !== 'string') return false;
      try {
        return new RegExp(right, 'i').test(left);
      } catch {
        return false;
      }
    case 'in':
      return Array.isArray(right) && right.some((v) => v == left); // eslint-disable-line eqeqeq
    case 'not_in':
      return Array.isArray(right) && !right.some((v) => v == left); // eslint-disable-line eqeqeq
    case 'exists':
      return left !== undefined && left !== null;
    case 'is_empty':
      return left === undefined || left === null || left === '' || (Array.isArray(left) && left.length === 0);
    default:
      return false;
  }
}

export interface EvaluationResult {
  matched: boolean;
  needs_llm: boolean;
  llm_reason?: string;
}

export function evaluateCondition(
  cond: Condition,
  ctx: Record<string, unknown>,
): EvaluationResult {
  if ('fallback_llm' in cond) {
    return { matched: false, needs_llm: true, llm_reason: cond.reason };
  }
  if ('all' in cond) {
    for (const sub of cond.all) {
      const r = evaluateCondition(sub, ctx);
      if (r.needs_llm) return r;
      if (!r.matched) return { matched: false, needs_llm: false };
    }
    return { matched: true, needs_llm: false };
  }
  if ('any' in cond) {
    let needsLlm: EvaluationResult | null = null;
    for (const sub of cond.any) {
      const r = evaluateCondition(sub, ctx);
      if (r.needs_llm) {
        // Defer LLM until we know none of the others matched deterministically.
        needsLlm = r;
        continue;
      }
      if (r.matched) return { matched: true, needs_llm: false };
    }
    if (needsLlm) return needsLlm;
    return { matched: false, needs_llm: false };
  }
  if ('not' in cond) {
    const r = evaluateCondition(cond.not, ctx);
    if (r.needs_llm) return r;
    return { matched: !r.matched, needs_llm: false };
  }
  // Leaf
  const left = getField(ctx, cond.field);
  return { matched: compare(left, cond.op, cond.value), needs_llm: false };
}

export interface CompiledRule {
  when: Condition;
  then: Record<string, unknown>;
  fallback_llm?: boolean;
}

// Picks the first matching active rule from a priority-ordered list.
// Returns the rule's `then` action, or null if no rule matched.
// needs_llm rules are returned with then=null and a flag so the caller
// can decide whether to invoke the LLM fallback.
export interface RuleMatchResult {
  matchedRuleId: string | null;
  action: Record<string, unknown> | null;
  needs_llm: boolean;
  llm_reason?: string;
}

export function findFirstMatch(
  rules: Array<{ id: string; compiled: CompiledRule }>,
  ctx: Record<string, unknown>,
): RuleMatchResult {
  let pendingLlm: { id: string; reason: string } | null = null;
  for (const rule of rules) {
    const r = evaluateCondition(rule.compiled.when, ctx);
    if (r.needs_llm) {
      // Park it — if a later deterministic rule matches, that wins.
      if (!pendingLlm) pendingLlm = { id: rule.id, reason: r.llm_reason ?? 'fallback' };
      continue;
    }
    if (r.matched) {
      return {
        matchedRuleId: rule.id,
        action: rule.compiled.then,
        needs_llm: false,
      };
    }
  }
  if (pendingLlm) {
    return {
      matchedRuleId: pendingLlm.id,
      action: null,
      needs_llm: true,
      llm_reason: pendingLlm.reason,
    };
  }
  return { matchedRuleId: null, action: null, needs_llm: false };
}
