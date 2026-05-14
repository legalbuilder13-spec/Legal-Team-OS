import { describe, expect, it } from 'vitest';
import {
  DomainConfigSchema,
  EMPTY_DOMAIN_CONFIG,
  hasDomainConfigContent,
} from './domain-config.js';

describe('DomainConfigSchema', () => {
  it('accepts the empty config', () => {
    expect(DomainConfigSchema.safeParse(EMPTY_DOMAIN_CONFIG).success).toBe(true);
  });

  it('accepts a fully populated config', () => {
    const cfg = {
      factualBaselineFacts: ['The organization is an online marketplace.'],
      terminologyRules: [{ preferred: 'professional', avoid: 'employee', rationale: 'IC framing' }],
      verbRules: [{ prefer: 'verifies', avoid: 'ensures', context: 'compliance' }],
      highScrutinyJurisdictions: [
        { jurisdiction: 'California', rationale: 'AB5', appliesToPracticeAreas: ['employment'] },
      ],
      domainRiskTaxonomy: [
        { categoryId: 'control', label: 'Behavioral control', examplesFlag: ['sets pay'], defaultSeverity: 'high' },
      ],
      preferredResearchDatabase: 'westlaw',
      escalationThresholds: {
        financialBetTheCompanyUsd: 5_000_000,
        confidenceLowRouting: 'senior_reviewer',
      },
    };
    expect(DomainConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('rejects invalid severity', () => {
    const cfg = {
      ...EMPTY_DOMAIN_CONFIG,
      domainRiskTaxonomy: [{ categoryId: 'x', label: 'y', examplesFlag: [], defaultSeverity: 'unknown' }],
    };
    expect(DomainConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it('rejects invalid research database', () => {
    const cfg = { ...EMPTY_DOMAIN_CONFIG, preferredResearchDatabase: 'made_up' };
    expect(DomainConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it('rejects negative financial threshold', () => {
    const cfg = {
      ...EMPTY_DOMAIN_CONFIG,
      escalationThresholds: { financialBetTheCompanyUsd: -1 },
    };
    expect(DomainConfigSchema.safeParse(cfg).success).toBe(false);
  });
});

describe('hasDomainConfigContent', () => {
  it('returns false for empty config', () => {
    expect(hasDomainConfigContent(EMPTY_DOMAIN_CONFIG)).toBe(false);
  });

  it('returns true with any terminology rule', () => {
    expect(
      hasDomainConfigContent({
        ...EMPTY_DOMAIN_CONFIG,
        terminologyRules: [{ preferred: 'x', avoid: 'y' }],
      }),
    ).toBe(true);
  });

  it('returns true with any high-scrutiny jurisdiction', () => {
    expect(
      hasDomainConfigContent({
        ...EMPTY_DOMAIN_CONFIG,
        highScrutinyJurisdictions: [{ jurisdiction: 'CA', appliesToPracticeAreas: [] }],
      }),
    ).toBe(true);
  });

  it('returns true with any factual baseline fact', () => {
    expect(
      hasDomainConfigContent({
        ...EMPTY_DOMAIN_CONFIG,
        factualBaselineFacts: ['something'],
      }),
    ).toBe(true);
  });

  it('returns false when only escalationThresholds is set', () => {
    // Thresholds aren't part of the prompt-content check; they affect
    // routing logic but not the skill prompt.
    expect(
      hasDomainConfigContent({
        ...EMPTY_DOMAIN_CONFIG,
        escalationThresholds: { financialBetTheCompanyUsd: 100_000 },
      }),
    ).toBe(false);
  });
});
