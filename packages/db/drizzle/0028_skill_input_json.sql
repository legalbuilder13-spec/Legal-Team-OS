-- Item 8 follow-up — capture skill input JSON on matter_analysis_stages so
-- the eval corpus + replay runner can reconstruct skill calls without
-- guessing. The hash already in input_hash is opaque; this stores the
-- actual structured request the skill saw.
--
-- Backfill is intentionally null — old stages can't be replayed; new
-- stages get full replay-ability.

ALTER TABLE "matter_analysis_stages"
  ADD COLUMN "skill_input_json" jsonb;
