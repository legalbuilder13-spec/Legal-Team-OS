import { describe, expect, it } from 'vitest';
import { pickWorseConfidence } from './analyze.js';

describe('pickWorseConfidence', () => {
  it('returns LOW when either input is LOW', () => {
    expect(pickWorseConfidence('LOW', 'HIGH')).toBe('LOW');
    expect(pickWorseConfidence('HIGH', 'LOW')).toBe('LOW');
  });

  it('returns SPLIT when either is SPLIT and neither is LOW', () => {
    expect(pickWorseConfidence('SPLIT', 'HIGH')).toBe('SPLIT');
    expect(pickWorseConfidence('HIGH', 'SPLIT')).toBe('SPLIT');
  });

  it('returns MEDIUM when either is MEDIUM and neither LOW/SPLIT', () => {
    expect(pickWorseConfidence('MEDIUM', 'HIGH')).toBe('MEDIUM');
    expect(pickWorseConfidence('HIGH', 'MEDIUM')).toBe('MEDIUM');
  });

  it('returns HIGH only when both are HIGH', () => {
    expect(pickWorseConfidence('HIGH', 'HIGH')).toBe('HIGH');
  });

  it('treats N_A as neutral — returns the other side', () => {
    expect(pickWorseConfidence('N_A', 'MEDIUM')).toBe('MEDIUM');
    expect(pickWorseConfidence('HIGH', 'N_A')).toBe('HIGH');
  });

  it('returns the other side when both are N_A', () => {
    // Both neutral — function returns either; check it doesn't throw
    // and the result is N_A.
    expect(pickWorseConfidence('N_A', 'N_A')).toBe('N_A');
  });

  it('LOW vs SPLIT picks LOW', () => {
    expect(pickWorseConfidence('LOW', 'SPLIT')).toBe('LOW');
  });
});
