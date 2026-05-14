import { describe, expect, it } from 'vitest';
import { compareExcerpt } from './take-snapshot.js';

describe('compareExcerpt', () => {
  it('returns verified when excerpt is a substring of page text', () => {
    expect(
      compareExcerpt(
        'shall conduct background checks',
        'Healthcare facilities shall conduct background checks pursuant to subsection (a).',
      ),
    ).toBe('verified');
  });

  it('returns verified across whitespace differences', () => {
    expect(
      compareExcerpt(
        'shall   conduct\nbackground\nchecks',
        'Healthcare facilities shall conduct background checks.',
      ),
    ).toBe('verified');
  });

  it('returns minor_discrepancy when 80%+ of tokens match', () => {
    // Excerpt has 5 long tokens; 4 of 5 in page text.
    expect(
      compareExcerpt(
        'conduct background checks pursuant subsection',
        'Facilities conduct background checks pursuant to the Department.',
      ),
    ).toBe('minor_discrepancy');
  });

  it('returns material_discrepancy when fewer than 80% of tokens match', () => {
    expect(
      compareExcerpt(
        'requires monthly fingerprinting accreditation appeals',
        'A simple privacy notice must be displayed prominently.',
      ),
    ).toBe('material_discrepancy');
  });

  it('returns verified for an empty excerpt (nothing to verify)', () => {
    expect(compareExcerpt('', 'arbitrary page text')).toBe('verified');
  });

  it('returns minor_discrepancy when excerpt has no long tokens to compare', () => {
    // All tokens are <= 3 chars; the 80% comparison can't run cleanly.
    expect(compareExcerpt('a b c d', 'the abc')).toBe('minor_discrepancy');
  });
});
