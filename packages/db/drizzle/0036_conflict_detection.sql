-- PR #7 / M8 — Conflict detection across content tables.
--
-- Closes the loop opened by PR #1 (cross-links): now that knowledge,
-- playbooks, rules, templates, patterns, and clauses can reference
-- each other, contradictions become detectable. A weekly cron runs
-- structural checks and writes one `detected_conflicts` row per
-- detected pair. Admin reviews + resolves at /admin/conflicts.
--
-- v1 ships three structural checks (no LLM cost):
--   1. Duplicate canonical clauses (same name, same practice_area, both is_canonical=true)
--   2. Rule priority collisions (same kind, same priority, both active)
--   3. Near-duplicate active playbooks by embedding distance (cosine > 0.93 in same practice_area)
-- AI-based deep checks (semantic contradiction analysis) are a
-- follow-up.

CREATE TYPE "conflict_kind" AS ENUM (
  'duplicate_canonical_clause',
  'rule_priority_collision',
  'near_duplicate_playbook',
  'kb_playbook_drift'
);

CREATE TYPE "conflict_severity" AS ENUM ('high', 'medium', 'low');

CREATE TYPE "conflict_status" AS ENUM ('active', 'dismissed', 'resolved');

CREATE TABLE "detected_conflicts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" "conflict_kind" NOT NULL,
  "severity" "conflict_severity" NOT NULL DEFAULT 'medium',
  -- Polymorphic pair. Both sides have a type + id; for single-entity
  -- conflicts (none today, but reserved) the b columns are nullable.
  "entity_a_type" text NOT NULL,
  "entity_a_id" uuid NOT NULL,
  "entity_b_type" text,
  "entity_b_id" uuid,
  "summary" text NOT NULL,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "detector_version" text NOT NULL DEFAULT 'v1',
  "status" "conflict_status" NOT NULL DEFAULT 'active',
  "resolved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamp with time zone,
  "resolution_note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "detected_conflicts_status_idx"
  ON "detected_conflicts" ("status", "severity", "created_at" DESC);
CREATE INDEX "detected_conflicts_entity_a_idx"
  ON "detected_conflicts" ("entity_a_type", "entity_a_id");
CREATE INDEX "detected_conflicts_entity_b_idx"
  ON "detected_conflicts" ("entity_b_type", "entity_b_id");
-- Unique constraint prevents the cron from re-creating an active
-- conflict that was already flagged. Re-runs of the cron are idempotent
-- as long as the conflict's structural signature is unchanged.
CREATE UNIQUE INDEX "detected_conflicts_active_unique_idx"
  ON "detected_conflicts" ("kind", "entity_a_type", "entity_a_id", "entity_b_type", "entity_b_id")
  WHERE "status" = 'active';

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'detect_conflicts';
