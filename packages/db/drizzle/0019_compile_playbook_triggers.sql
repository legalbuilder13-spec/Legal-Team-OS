-- G4: store compiled DSL alongside the NL trigger on playbook positions.
-- Pre-filter for the clause-analysis worker: positions whose compiled
-- trigger doesn't match the clause text are skipped before the LLM
-- call. Reduces token usage + sharpens the LLM's focus.

ALTER TABLE "playbook_positions"
  ADD COLUMN IF NOT EXISTS "compiled_trigger" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "compiler_version" text,
  ADD COLUMN IF NOT EXISTS "compiled_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "compile_error" text;
