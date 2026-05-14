-- PR12 §15 — per-organization domain config. Single-tenant in v1: a
-- singleton "default" org is created in this migration and every
-- existing user is pointed at it. Multi-tenant separation (per-org
-- data isolation, per-org Clerk SSO) is a future PR; this migration
-- just gives every deployment a place to put org-specific terminology
-- rules, verb rules, jurisdiction risk flags, domain risk taxonomy,
-- and factual baseline facts.

CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "domain_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Seed the default org. Slug 'default' is the lookup key the worker
-- helpers use when a user has no explicit organization_id (back-compat
-- for matters created before this migration).
INSERT INTO "organizations" ("name", "slug", "domain_config")
VALUES (
  'Default Organization',
  'default',
  '{
    "factual_baseline_facts": [],
    "terminology_rules": [],
    "verb_rules": [],
    "high_scrutiny_jurisdictions": [],
    "domain_risk_taxonomy": [],
    "escalation_thresholds": {}
  }'::jsonb
);

ALTER TABLE "users"
  ADD COLUMN "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL;

-- Back-fill every existing user with the default org. New users created
-- through the existing ensureUser flow inherit NULL and the worker
-- helpers transparently treat NULL as "default."
UPDATE "users" SET "organization_id" = (SELECT id FROM "organizations" WHERE slug = 'default');

CREATE INDEX "users_organization_idx" ON "users" ("organization_id");
