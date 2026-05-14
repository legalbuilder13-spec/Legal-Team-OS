import { eq, sql } from 'drizzle-orm';
import { organizations, users, type Db } from '@legal/db';
import {
  DomainConfigSchema,
  EMPTY_DOMAIN_CONFIG,
  type DomainConfig,
} from '@legal/types';

// PR12 §15 — domain-config loader. Resolves the organization for a
// given user (or matter requester) and returns the parsed DomainConfig.
// Falls back to the singleton 'default' org for users without an
// explicit organization_id. Returns EMPTY_DOMAIN_CONFIG if no org row
// exists at all (shouldn't happen post-migration but keeps the
// pipeline running in test environments).
//
// Per-request cache: each worker job loads once. Worker jobs are
// short-lived so we don't need a longer-lived cache.

let _defaultOrgId: string | null = null;

async function defaultOrgId(db: Db): Promise<string | null> {
  if (_defaultOrgId) return _defaultOrgId;
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, 'default'))
    .limit(1);
  _defaultOrgId = rows[0]?.id ?? null;
  return _defaultOrgId;
}

export async function loadOrgConfigForUser(
  db: Db,
  userId: string | null | undefined,
): Promise<DomainConfig> {
  if (!userId) {
    return loadOrgConfigForOrg(db, null);
  }
  const rows = await db
    .select({ orgId: users.organizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const orgId = rows[0]?.orgId ?? null;
  return loadOrgConfigForOrg(db, orgId);
}

export async function loadOrgConfigForOrg(
  db: Db,
  orgId: string | null,
): Promise<DomainConfig> {
  const resolvedId = orgId ?? (await defaultOrgId(db));
  if (!resolvedId) return EMPTY_DOMAIN_CONFIG;
  const rows = await db
    .select({ config: organizations.domainConfig })
    .from(organizations)
    .where(eq(organizations.id, resolvedId))
    .limit(1);
  const raw = rows[0]?.config;
  if (!raw || typeof raw !== 'object') return EMPTY_DOMAIN_CONFIG;
  // Zod parse — if the stored config is malformed, log + return empty
  // rather than crashing the pipeline.
  const parsed = DomainConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('org_config: stored domain_config is malformed', {
      orgId: resolvedId,
      issues: parsed.error.issues.slice(0, 5),
    });
    return EMPTY_DOMAIN_CONFIG;
  }
  return parsed.data;
}

// Helper to convert the DomainConfig into a serializable shape the
// AI skills can consume. Strips fields irrelevant for the skill's
// prompt context (factualBaselineKbPage is worker-side only) and
// snake-cases keys to match the Python pydantic models.
export function domainConfigForSkill(c: DomainConfig): Record<string, unknown> {
  void sql; // explicit import keeps drizzle re-exports happy in worker bundle
  return {
    factual_baseline_facts: c.factualBaselineFacts,
    terminology_rules: c.terminologyRules.map((r) => ({
      preferred: r.preferred,
      avoid: r.avoid,
      rationale: r.rationale ?? null,
    })),
    verb_rules: c.verbRules.map((r) => ({
      prefer: r.prefer,
      avoid: r.avoid,
      context: r.context ?? null,
    })),
    high_scrutiny_jurisdictions: c.highScrutinyJurisdictions.map((j) => ({
      jurisdiction: j.jurisdiction,
      rationale: j.rationale ?? null,
      applies_to_practice_areas: j.appliesToPracticeAreas,
    })),
    domain_risk_taxonomy: c.domainRiskTaxonomy.map((cat) => ({
      category_id: cat.categoryId,
      label: cat.label,
      examples_flag: cat.examplesFlag,
      default_severity: cat.defaultSeverity,
    })),
  };
}
