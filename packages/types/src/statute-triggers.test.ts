import { describe, expect, it } from 'vitest';
import {
  extractCaseCitations,
  extractStatuteCitations,
  detectStatuteKeywords,
  STATUTE_KEYWORD_TRIGGERS,
} from './statute-triggers.js';

describe('extractStatuteCitations', () => {
  it('extracts USC citations', () => {
    const out = extractStatuteCitations('42 U.S.C. § 1395cc(a)(1)(A) applies here.');
    const kinds = out.map((m) => m.kind);
    expect(kinds).toContain('us_code');
    expect(out[0]!.raw).toMatch(/42\s*U\.?\s?S\.?\s?C\.?\s*§?\s*1395cc/);
  });

  it('extracts CFR citations', () => {
    const out = extractStatuteCitations('See 45 C.F.R. § 164.502 for the rule.');
    expect(out.some((m) => m.kind === 'cfr')).toBe(true);
  });

  it('handles missing periods + spaces in USC', () => {
    const out = extractStatuteCitations('Under 17 USC 106 the exclusive rights are…');
    expect(out.some((m) => m.kind === 'us_code')).toBe(true);
  });

  it('dedupes citations seen twice', () => {
    const out = extractStatuteCitations('See 42 U.S.C. § 1395cc and 42 U.S.C. § 1395cc again.');
    const usCount = out.filter((m) => m.kind === 'us_code').length;
    expect(usCount).toBe(1);
  });

  it('returns empty when no citation is present', () => {
    expect(extractStatuteCitations('plain prose about facts')).toEqual([]);
  });

  it('tags federal citations with the federal jurisdiction hint', () => {
    const out = extractStatuteCitations('17 U.S.C. § 106');
    expect(out[0]!.jurisdictionHint).toBe('federal');
  });

  it('extracts at least one state-code citation', () => {
    const out = extractStatuteCitations('Cal. Civ. Code § 1798.140 controls.');
    expect(out.some((m) => m.kind === 'state_code')).toBe(true);
  });

  it('extracts public law numbers', () => {
    const out = extractStatuteCitations('Pub. L. 117-103 amended the Act.');
    expect(out.some((m) => m.kind === 'public_law')).toBe(true);
  });
});

describe('detectStatuteKeywords', () => {
  it('matches case-insensitively', () => {
    expect(detectStatuteKeywords('this matter involves title vii claims')).toContain('Title VII');
  });

  it('returns empty for irrelevant text', () => {
    expect(detectStatuteKeywords('nothing to see here')).toEqual([]);
  });

  it('returns multiple matches', () => {
    const out = detectStatuteKeywords('the FLSA + the ADA + ERISA are all in play');
    expect(out).toEqual(expect.arrayContaining(['FLSA', 'ADA', 'ERISA']));
  });

  it('STATUTE_KEYWORD_TRIGGERS contains the core federal statutes', () => {
    for (const k of ['Title VII', 'ADA', 'ADEA', 'FLSA', 'HIPAA', 'ERISA', 'CCPA', 'GDPR']) {
      expect(STATUTE_KEYWORD_TRIGGERS).toContain(k);
    }
  });
});

describe('extractCaseCitations', () => {
  it('extracts a v. cite even without a reporter', () => {
    expect(extractCaseCitations('See Smith v. Jones for the rule.')).toContain('Smith v. Jones');
  });

  it('extracts cite with reporter', () => {
    const out = extractCaseCitations('See Brown v. Board, 347 U.S. 483.');
    // Either form is fine for v1; we just need one match.
    expect(out.length).toBeGreaterThan(0);
  });

  it('dedupes the same cite seen twice', () => {
    const out = extractCaseCitations('Smith v. Jones held … See Smith v. Jones at 5.');
    expect(out.filter((c) => c === 'Smith v. Jones')).toHaveLength(1);
  });

  it('returns empty for prose without cites', () => {
    expect(extractCaseCitations('No cases here.')).toEqual([]);
  });
});
