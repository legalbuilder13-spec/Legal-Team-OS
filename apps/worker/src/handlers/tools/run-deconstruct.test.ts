import { describe, expect, it } from 'vitest';
import { thresholdFirstOrderingCheck, type SkillNode } from './run-deconstruct.js';

function node(over: Partial<SkillNode> & { id: string }): SkillNode {
  return {
    parent_id: null,
    question: 'q',
    type: 'rule',
    status: 'open',
    anchor_citation: null,
    ...over,
  };
}

describe('thresholdFirstOrderingCheck', () => {
  it('returns empty when all thresholds are at the top', () => {
    const nodes: SkillNode[] = [
      node({ id: 'sol', type: 'threshold' }),
      node({ id: 'preempt', type: 'threshold' }),
      node({ id: 'rule_1', parent_id: 'sol', type: 'rule' }),
    ];
    expect(thresholdFirstOrderingCheck(nodes)).toEqual([]);
  });

  it('flags a threshold node with a non-threshold parent', () => {
    const nodes: SkillNode[] = [
      node({ id: 'rule_1', type: 'rule' }),
      node({ id: 'sol', parent_id: 'rule_1', type: 'threshold' }),
    ];
    const failures = thresholdFirstOrderingCheck(nodes);
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain('sol');
    expect(failures[0]).toContain('non-threshold parent');
  });

  it('flags multiple buried thresholds', () => {
    const nodes: SkillNode[] = [
      node({ id: 'rule_1', type: 'rule' }),
      node({ id: 'rule_2', type: 'rule' }),
      node({ id: 'sol', parent_id: 'rule_1', type: 'threshold' }),
      node({ id: 'preempt', parent_id: 'rule_2', type: 'threshold' }),
    ];
    expect(thresholdFirstOrderingCheck(nodes).length).toBe(2);
  });

  it('allows a threshold child of another threshold', () => {
    const nodes: SkillNode[] = [
      node({ id: 'jurisdiction', type: 'threshold' }),
      node({ id: 'subject_matter', parent_id: 'jurisdiction', type: 'threshold' }),
    ];
    expect(thresholdFirstOrderingCheck(nodes)).toEqual([]);
  });

  it('flags references to missing parents', () => {
    const nodes: SkillNode[] = [
      node({ id: 'sol', parent_id: 'ghost', type: 'threshold' }),
    ];
    const failures = thresholdFirstOrderingCheck(nodes);
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain('missing parent');
  });

  it('does not flag non-threshold nodes under non-threshold parents', () => {
    const nodes: SkillNode[] = [
      node({ id: 'duty', type: 'rule' }),
      node({ id: 'breach', parent_id: 'duty', type: 'standard' }),
      node({ id: 'damages', parent_id: 'duty', type: 'rule' }),
    ];
    expect(thresholdFirstOrderingCheck(nodes)).toEqual([]);
  });
});
