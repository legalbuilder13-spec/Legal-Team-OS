-- Polymorphic cross-references between the system's content tables.
-- Today the five content tables (playbooks, knowledge_articles, rules,
-- templates, execution_patterns) sit in silos with no foreign keys
-- between them, even though they obviously relate (a KB article
-- explains the reasoning behind a playbook; a template implements a
-- playbook's standard clause; a rule auto-triggers a playbook).
--
-- This table records those relationships polymorphically. Each row is
-- (source_type, source_id) -> (target_type, target_id) labeled by a
-- `relationship`. Self-references are rejected by a CHECK constraint.
-- Duplicate edges (same source/target/relationship) are rejected by
-- the UNIQUE index.
--
-- Because the IDs are polymorphic, we can't use real foreign keys to
-- the underlying rows. Orphan cleanup is handled application-side
-- (delete cascading via the routers) or by a periodic sweep — for
-- now an orphaned link just renders as "missing" in the UI.

CREATE TYPE "entity_link_kind" AS ENUM (
  'playbook',
  'knowledge_article',
  'rule',
  'template',
  'execution_pattern',
  'matter'
);

CREATE TYPE "entity_link_relationship" AS ENUM (
  'codifies',
  'implements',
  'triggers',
  'cites',
  'supersedes',
  'derived_from',
  'related_to'
);

CREATE TABLE "entity_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_type" "entity_link_kind" NOT NULL,
  "source_id" uuid NOT NULL,
  "target_type" "entity_link_kind" NOT NULL,
  "target_id" uuid NOT NULL,
  "relationship" "entity_link_relationship" NOT NULL,
  "note" text,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "entity_links_no_self_reference" CHECK (
    NOT ("source_type" = "target_type" AND "source_id" = "target_id")
  )
);

CREATE UNIQUE INDEX "entity_links_unique_idx"
  ON "entity_links" ("source_type", "source_id", "target_type", "target_id", "relationship");

CREATE INDEX "entity_links_source_idx"
  ON "entity_links" ("source_type", "source_id");

CREATE INDEX "entity_links_target_idx"
  ON "entity_links" ("target_type", "target_id");
