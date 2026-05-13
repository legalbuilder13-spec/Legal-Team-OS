-- Stage 4 playbook executability. Today playbooks are unstructured
-- markdown advisory text. This migration adds playbook_positions — one
-- row per executable position (e.g. 'Liability Cap', 'IP Indemnification')
-- with the structured fields needed by E3's clause-analysis engine.
--
-- The embedding column supports similarity-based clause-to-position
-- matching: when analyzing a clause, E3 finds the top-K positions by
-- cosine similarity and asks the LLM to tag the clause against them.
-- Uses voyage-law-2 (1024 dims) consistent with matters.embedding.

CREATE TABLE "playbook_positions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playbook_id" uuid NOT NULL REFERENCES "playbooks"("id") ON DELETE CASCADE,
  "topic" text NOT NULL,
  "trigger" text NOT NULL,
  "standard_position" text NOT NULL,
  "acceptable_range" text,
  "flagged_conditions" text,
  "suggested_redline" text,
  "citation" text,
  "embedding" vector(1024),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "playbook_positions_playbook_idx" ON "playbook_positions" ("playbook_id");
CREATE INDEX "playbook_positions_active_idx" ON "playbook_positions" ("is_active");
