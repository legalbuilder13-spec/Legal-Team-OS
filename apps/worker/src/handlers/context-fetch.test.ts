import { describe, expect, it } from 'vitest';
import { hostnameFromWebsite } from '../utils';

describe('hostnameFromWebsite', () => {
  it('strips protocol and www prefix', () => {
    expect(hostnameFromWebsite('https://www.acme.com/')).toBe('acme.com');
  });

  it('handles bare domains by adding https://', () => {
    expect(hostnameFromWebsite('acme.com')).toBe('acme.com');
  });

  it('handles http (insecure) URLs', () => {
    expect(hostnameFromWebsite('http://acme.com/contact')).toBe('acme.com');
  });

  it('lowercases the hostname', () => {
    expect(hostnameFromWebsite('https://ACME.com')).toBe('acme.com');
  });

  it('returns undefined for null, undefined, empty, or whitespace', () => {
    expect(hostnameFromWebsite(null)).toBeUndefined();
    expect(hostnameFromWebsite(undefined)).toBeUndefined();
    expect(hostnameFromWebsite('')).toBeUndefined();
    expect(hostnameFromWebsite('   ')).toBeUndefined();
  });

  it('returns undefined for unparseable junk', () => {
    expect(hostnameFromWebsite('not a url at all')).toBeUndefined();
  });
});
