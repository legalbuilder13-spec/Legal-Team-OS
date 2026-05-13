-- PRD §7.2.4 Practice-area-specific execution patterns. Different
-- practice areas need different output formats:
--   commercial/sales/procurement → clause-by-clause tagged analysis + redline
--   employment/HR → issue-flagged memo
--   litigation → claim matrix + strategy memo
--   regulatory/compliance → gap report against requirements checklist
--   ip → risk assessment + recommendations
--   marketing → flagged content with rewrite suggestions
--   corporate (general) → action item checklist
-- This migration adds the configuration table. The clause-by-clause
-- flow shipped in E3 covers the first bucket (the most common one).
-- Other output formats are tracked but not implemented in F3 — each
-- requires its own AI service endpoint and review UI as follow-ups.

CREATE TYPE "execution_pattern_input_type" AS ENUM (
  'document', 'fact_pattern', 'checklist', 'content'
);

CREATE TYPE "execution_pattern_output_format" AS ENUM (
  'tagged_clauses',
  'issue_memo',
  'claim_matrix',
  'gap_report',
  'risk_assessment',
  'rewrite_pairs',
  'action_checklist'
);

CREATE TABLE "execution_patterns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "practice_area" "practice_area" NOT NULL,
  "matter_type" text,
  "input_type" "execution_pattern_input_type" NOT NULL,
  "output_format" "execution_pattern_output_format" NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "prompt_template" text NOT NULL,
  "output_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "execution_patterns_practice_area_idx" ON "execution_patterns" ("practice_area");
CREATE UNIQUE INDEX "execution_patterns_default_per_area_uq"
  ON "execution_patterns" ("practice_area", "is_default")
  WHERE "is_default" = true;

-- Seed default patterns mapping each practice area to the appropriate
-- output_format per PRD §7.2.4 Table. These are pointers to what
-- needs to be built; only tagged_clauses (commercial/employment-when-
-- contract/privacy/ip) is fully implemented today via E3.
INSERT INTO "execution_patterns" (
  practice_area, input_type, output_format, name, description,
  prompt_template, is_default
) VALUES
  ('commercial', 'document', 'tagged_clauses',
   'Clause-by-clause contract review',
   'Standard commercial contract review. Each clause tagged STANDARD/MODIFIED/FLAGGED against playbook positions.',
   '(uses analyze-clause worker — no separate prompt template here)',
   true),
  ('employment', 'document', 'issue_memo',
   'Employment document issue-flagged memo',
   'Non-compete scope, severance terms, benefits, classification — flagged in memo form.',
   'TODO: not yet implemented; falls back to tagged_clauses if document is contract-like.',
   true),
  ('litigation', 'fact_pattern', 'claim_matrix',
   'Claim-by-claim matrix + strategy memo',
   'Elements per cause of action, defenses, exposure analysis.',
   'TODO: not yet implemented.',
   true),
  ('privacy', 'document', 'tagged_clauses',
   'DPA / privacy-clause review',
   'Tagged clause review focused on data subject rights, processor obligations, cross-border transfer, breach notification.',
   '(uses analyze-clause worker)',
   true),
  ('regulatory', 'checklist', 'gap_report',
   'Regulatory gap report',
   'Applicable regulations, requirements checklist, gap analysis.',
   'TODO: not yet implemented.',
   true),
  ('ip', 'document', 'risk_assessment',
   'IP risk assessment',
   'Ownership, licensing, infringement risk per IP asset.',
   'TODO: not yet implemented; falls back to tagged_clauses for license agreements.',
   true),
  ('real_estate', 'document', 'tagged_clauses',
   'Lease / property document review',
   'Tagged clause review focused on rent escalation, termination, assignment, indemnity.',
   '(uses analyze-clause worker)',
   true),
  ('corporate', 'checklist', 'action_checklist',
   'Corporate governance action checklist',
   'Board resolutions, entity formation, governance, filings — actionable items.',
   'TODO: not yet implemented.',
   true),
  ('other', 'document', 'tagged_clauses',
   'Generic document review',
   'Fallback pattern.',
   '(uses analyze-clause worker)',
   true);
