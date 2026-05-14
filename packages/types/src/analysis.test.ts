import { describe, expect, it } from 'vitest';
import {
  AnalysisConfidenceSchema,
  AnalysisStageNameSchema,
  CaseLawToolInvocationSchema,
  GUIDANCE_MATCH_THRESHOLDS,
  PIPELINE_VERSION,
  PreMeritsStageOutputSchema,
  StatutoryToolInvocationSchema,
  ThresholdSpotterFindingSchema,
  normalizeJurisdictions,
} from './analysis.js';

describe('AnalysisConfidenceSchema', () => {
  it('accepts the five allowed values', () => {
    for (const v of ['HIGH', 'MEDIUM', 'LOW', 'SPLIT', 'N_A']) {
      expect(AnalysisConfidenceSchema.safeParse(v).success).toBe(true);
    }
  });

  it('rejects lowercase variants', () => {
    expect(AnalysisConfidenceSchema.safeParse('high').success).toBe(false);
  });
});

describe('AnalysisStageNameSchema', () => {
  it('accepts the five stage names', () => {
    for (const v of ['pre_merits', 'guidance', 'statutory', 'case_law', 'deconstruct']) {
      expect(AnalysisStageNameSchema.safeParse(v).success).toBe(true);
    }
  });
});

describe('ThresholdSpotterFindingSchema', () => {
  it('accepts a well-formed finding', () => {
    const f = {
      id: 'sol',
      status: 'raised',
      confidence: 0.85,
      evidenceQuote: 'fired in 2019',
      oneLineJustification: 'Two-year delay puts limitations in play.',
    };
    expect(ThresholdSpotterFindingSchema.safeParse(f).success).toBe(true);
  });

  it('rejects out-of-range confidence', () => {
    const f = {
      id: 'sol',
      status: 'raised',
      confidence: 1.5,
      evidenceQuote: '',
      oneLineJustification: 'x',
    };
    expect(ThresholdSpotterFindingSchema.safeParse(f).success).toBe(false);
  });

  it('rejects unknown status', () => {
    const f = {
      id: 'sol',
      status: 'maybe',
      confidence: 0.5,
      evidenceQuote: '',
      oneLineJustification: 'x',
    };
    expect(ThresholdSpotterFindingSchema.safeParse(f).success).toBe(false);
  });
});

describe('PreMeritsStageOutputSchema', () => {
  it('validates a minimal valid output', () => {
    const out = {
      practiceArea: 'employment',
      checklistVersion: '1.0.0',
      findings: [],
      raisedHighSeverity: [],
    };
    expect(PreMeritsStageOutputSchema.safeParse(out).success).toBe(true);
  });
});

describe('GUIDANCE_MATCH_THRESHOLDS', () => {
  it('exposes the gate constants', () => {
    expect(GUIDANCE_MATCH_THRESHOLDS.onPointScoreForMatch).toBe(0.8);
    expect(GUIDANCE_MATCH_THRESHOLDS.onPointScoreForRelated).toBe(0.5);
    expect(GUIDANCE_MATCH_THRESHOLDS.maxAgeMonthsForMatch).toBe(18);
  });
});

describe('normalizeJurisdictions', () => {
  it('returns jurisdictions[] when present', () => {
    expect(normalizeJurisdictions({ jurisdictions: ['CA', 'TX'] })).toEqual(['CA', 'TX']);
  });

  it('wraps a single jurisdiction into a one-element array', () => {
    expect(normalizeJurisdictions({ jurisdiction: 'California' })).toEqual(['California']);
  });

  it('prefers jurisdictions[] over single jurisdiction', () => {
    expect(
      normalizeJurisdictions({ jurisdictions: ['NY'], jurisdiction: 'CA' }),
    ).toEqual(['NY']);
  });

  it('returns empty when neither is supplied', () => {
    expect(normalizeJurisdictions({})).toEqual([]);
  });

  it('handles empty jurisdictions array correctly', () => {
    // Empty array falls through to the single-jurisdiction fallback,
    // and with neither set returns [].
    expect(normalizeJurisdictions({ jurisdictions: [] })).toEqual([]);
  });
});

describe('StatutoryToolInvocationSchema', () => {
  const base = {
    matterId: '00000000-0000-0000-0000-000000000000',
    candidateStatutes: [],
    invokedByUserId: '00000000-0000-0000-0000-000000000001',
  };

  it('accepts multi-jurisdiction input', () => {
    expect(
      StatutoryToolInvocationSchema.safeParse({ ...base, jurisdictions: ['CA'] }).success,
    ).toBe(true);
  });

  it('accepts back-compat single jurisdiction', () => {
    expect(
      StatutoryToolInvocationSchema.safeParse({ ...base, jurisdiction: 'CA' }).success,
    ).toBe(true);
  });

  it('rejects when neither is supplied', () => {
    expect(StatutoryToolInvocationSchema.safeParse(base).success).toBe(false);
  });
});

describe('CaseLawToolInvocationSchema', () => {
  it('accepts an optional anchor opinion id', () => {
    const ok = CaseLawToolInvocationSchema.safeParse({
      matterId: '00000000-0000-0000-0000-000000000000',
      jurisdiction: 'federal',
      candidateDoctrines: [],
      anchorOpinionId: '12345',
      invokedByUserId: '00000000-0000-0000-0000-000000000001',
    });
    expect(ok.success).toBe(true);
  });

  it('works without an anchor opinion id', () => {
    const ok = CaseLawToolInvocationSchema.safeParse({
      matterId: '00000000-0000-0000-0000-000000000000',
      jurisdiction: 'federal',
      candidateDoctrines: [],
      invokedByUserId: '00000000-0000-0000-0000-000000000001',
    });
    expect(ok.success).toBe(true);
  });
});

describe('PIPELINE_VERSION', () => {
  it('is a non-empty semver string', () => {
    expect(typeof PIPELINE_VERSION).toBe('string');
    expect(PIPELINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
