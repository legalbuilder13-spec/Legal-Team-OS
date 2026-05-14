import { describe, expect, it } from 'vitest';
import { verifyQuotedAgainstSource } from './run-statutory.js';

const sources = [
  {
    rawText:
      'No covered entity shall use or disclose protected health information except as permitted by this subpart.',
    hash: 'sha-abc',
  },
  {
    rawText:
      'For purposes of this section, "personal information" means any information that identifies a consumer.',
    hash: 'sha-def',
  },
];

describe('verifyQuotedAgainstSource', () => {
  it('matches an exact verbatim quote', () => {
    const r = verifyQuotedAgainstSource(
      'No covered entity shall use or disclose protected health information',
      sources,
    );
    expect(r.matched).toBe(true);
    expect(r.sourceHash).toBe('sha-abc');
  });

  it('matches across whitespace differences', () => {
    const r = verifyQuotedAgainstSource(
      'No  covered\nentity   shall use or disclose',
      sources,
    );
    expect(r.matched).toBe(true);
  });

  it('returns matched=false for invented language', () => {
    const r = verifyQuotedAgainstSource(
      'Covered entities are required to encrypt all data at rest',
      sources,
    );
    expect(r.matched).toBe(false);
    expect(r.sourceHash).toBeNull();
  });

  it('returns matched=true for empty quoted text (nothing to verify)', () => {
    const r = verifyQuotedAgainstSource('', sources);
    expect(r.matched).toBe(true);
  });

  it('catches the wrong-source case', () => {
    // The first phrase is in source 1, not source 2 — confirm we
    // attribute it to source 1.
    const r = verifyQuotedAgainstSource(
      'except as permitted by this subpart',
      sources,
    );
    expect(r.matched).toBe(true);
    expect(r.sourceHash).toBe('sha-abc');
  });

  it('catches an operator-word swap (and → or)', () => {
    // Words "shall and" are not in source; ensure mis-swap doesn't
    // match against "shall ... or" by accident.
    const r = verifyQuotedAgainstSource('shall and disclose', sources);
    expect(r.matched).toBe(false);
  });

  it('returns matched=true for an empty source list when quote is empty', () => {
    expect(verifyQuotedAgainstSource('', []).matched).toBe(true);
  });

  it('returns matched=false for any non-empty quote against an empty source list', () => {
    expect(verifyQuotedAgainstSource('anything', []).matched).toBe(false);
  });
});
