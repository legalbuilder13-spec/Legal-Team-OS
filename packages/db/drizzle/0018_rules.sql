-- PRD §12.1 Natural-language configuration. Generic rules table backing
-- all 4 rule kinds (SLA, routing, triage, playbook trigger). Each rule
-- stores both the natural-language form (what the attorney typed) and
-- the compiled DSL (what the evaluator runs). The compiler is an LLM
-- pass — see /compile-rule endpoint.
--
-- Rule lifecycle: draft → shadow → active → (edits create new draft;
-- shadow runs in parallel with the prior active version for validation;
-- only one active rule per (kind, scope) at a time).

CREATE TYPE "rule_kind" AS ENUM (
  'sla',
  'routing',
  'triage',
  'playbook_trigger'
);

CREATE TYPE "rule_status" AS ENUM (
  'draft',
  'shadow',
  'active',
  'archived'
);

CREATE TABLE "rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" "rule_kind" NOT NULL,
  "name" text NOT NULL,
  "natural_text" text NOT NULL,
  "compiled" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "compile_error" text,
  "scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "priority" integer NOT NULL DEFAULT 100,
  "status" "rule_status" NOT NULL DEFAULT 'draft',
  "supersedes_id" uuid REFERENCES "rules"("id") ON DELETE SET NULL,
  "compiler_version" text,
  "compiled_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "activated_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "rules_kind_status_idx" ON "rules" ("kind", "status");
CREATE INDEX "rules_priority_idx" ON "rules" ("kind", "priority");
CREATE INDEX "rules_supersedes_idx" ON "rules" ("supersedes_id") WHERE "supersedes_id" IS NOT NULL;

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'compile_rule';
