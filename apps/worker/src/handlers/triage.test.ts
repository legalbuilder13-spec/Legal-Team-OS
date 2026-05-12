import { describe, expect, it } from 'vitest';
import { extractDomain, INTERNAL_DOMAINS } from '../utils.js';

describe('extractDomain', () => {
  it('returns the requester email domain when external', () => {
    expect(extractDomain('jane@acme.com', '')).toBe('acme.com');
  });

  it('skips internal domains in the requester email', () => {
    expect(extractDomain('jane@legalbuilder.com', '')).toBeNull();
  });

  it('falls back to scanning the request text for a domain', () => {
    expect(
      extractDomain(null, 'Vendor TinyCorp wants us to sign at tinycorp.io tomorrow.'),
    ).toBe('tinycorp.io');
  });

  it('prefers requester email over text', () => {
    expect(extractDomain('jane@acme.com', 'TinyCorp at tinycorp.io')).toBe('acme.com');
  });

  it('returns null when only internal domains appear', () => {
    expect(
      extractDomain('jane@legalbuilder.com', 'See legalbuilder.com/docs'),
    ).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(extractDomain(null, 'No domains here')).toBeNull();
  });

  it('exposes INTERNAL_DOMAINS as the configured allowlist', () => {
    expect(INTERNAL_DOMAINS.has('legalbuilder.com')).toBe(true);
    expect(INTERNAL_DOMAINS.has('acme.com')).toBe(false);
  });
});
