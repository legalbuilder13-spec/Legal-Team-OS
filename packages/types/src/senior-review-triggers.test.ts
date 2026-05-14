import { describe, expect, it } from 'vitest';
import { detectSeniorReviewTriggers, SENIOR_REVIEW_TRIGGERS } from './senior-review-triggers.js';

describe('detectSeniorReviewTriggers', () => {
  it('flags criminal exposure', () => {
    const t = detectSeniorReviewTriggers('We received a grand jury subpoena yesterday.');
    expect(t.find((x) => x.id === 'criminal_exposure')).toBeDefined();
  });

  it('flags regulator demands', () => {
    const t = detectSeniorReviewTriggers('Got a civil investigative demand from the AG.');
    expect(t.find((x) => x.id === 'regulator_demand')).toBeDefined();
  });

  it('flags bet-the-company exposure', () => {
    const t = detectSeniorReviewTriggers('This is a class action that could be existential.');
    expect(t.find((x) => x.id === 'bet_the_company')).toBeDefined();
  });

  it('flags ethics + privilege issues', () => {
    const t = detectSeniorReviewTriggers('The bar grievance alleges attorney-client privilege breach.');
    expect(t.find((x) => x.id === 'ethics_privilege')).toBeDefined();
  });

  it('returns empty for benign matters', () => {
    expect(detectSeniorReviewTriggers('Need to renew our SaaS vendor agreement')).toEqual([]);
  });

  it('catches multiple triggers in one request', () => {
    const t = detectSeniorReviewTriggers(
      'DOJ issued a grand jury subpoena and there\'s a related class action.',
    );
    const ids = t.map((x) => x.id);
    expect(ids).toContain('criminal_exposure');
    expect(ids).toContain('bet_the_company');
  });

  it('every shipped trigger has at least one pattern', () => {
    for (const trig of SENIOR_REVIEW_TRIGGERS) {
      expect(trig.patterns.length).toBeGreaterThan(0);
    }
  });

  it('severity is one of the allowed levels', () => {
    for (const trig of SENIOR_REVIEW_TRIGGERS) {
      expect(['critical', 'high', 'medium']).toContain(trig.severity);
    }
  });
});
