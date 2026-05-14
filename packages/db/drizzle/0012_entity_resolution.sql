-- Cross-system entity resolution (PRD §6.2.3 / Stage 3 + Stage 7).
--
-- The same company appears as 'Acme Corp', 'Acme, Inc.', 'Acme
-- Corporation', and 'acme.com' across CRM / Slack / Notion / contracts.
-- Without resolution they become N separate counterparty rows, each with
-- their own fragmented behavioral profile. This migration adds the alias
-- table + pg_trgm similarity for fuzzy matching, used by a new
-- resolveCounterparty helper called from the triage handler.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "entity_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "counterparty_id" uuid NOT NULL REFERENCES "counterparties"("id") ON DELETE CASCADE,
  "alias_text" text NOT NULL,
  "alias_source" text NOT NULL,
  "confidence" real,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "entity_aliases_counterparty_text_uq" UNIQUE ("counterparty_id", "alias_text")
);

CREATE INDEX "entity_aliases_counterparty_idx" ON "entity_aliases" ("counterparty_id");
CREATE INDEX "entity_aliases_text_trgm_idx" ON "entity_aliases" USING gin ("alias_text" gin_trgm_ops);

-- Trigram index on counterparties.name to support fuzzy matching against
-- canonical names too (not just aliases).
CREATE INDEX IF NOT EXISTS "counterparties_name_trgm_idx" ON "counterparties" USING gin ("name" gin_trgm_ops);
