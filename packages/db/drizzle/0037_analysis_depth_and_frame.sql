-- PR-A: analysis-pipeline foundations.
-- (1) research_depth enum + column on matter_analyses. Drives every
--     downstream stage: how many retrieval strategies, whether the
--     absence spotter runs, whether ensemble retrieval fires, etc.
-- (2) doctrinal_frame jsonb column on matter_analyses. Carries the
--     pipeline's Bayesian-state hypothesis about what regime governs
--     this matter; stages may propose flips when authority arrives.
-- (3) escalated_at timestamp on matter_analyses. escalation_reason
--     already exists from PR-A's earlier ancestor; we just add the
--     timestamp so the worker can short-circuit and the UI can
--     render the badge correctly.
-- (4) matter_frame_flips table — one row per flip proposal. Lawyer
--     accepts or rejects; on accept, matter_analyses.doctrinal_frame
--     is updated and downstream stages re-read.

CREATE TYPE "research_depth" AS ENUM (
  'quick_take',
  'client_advice',
  'filing_grade',
  'bet_the_company'
);

ALTER TABLE "matter_analyses"
  ADD COLUMN "research_depth" "research_depth" NOT NULL DEFAULT 'client_advice',
  ADD COLUMN "doctrinal_frame" jsonb,
  ADD COLUMN "escalated_at" timestamp with time zone;

CREATE INDEX "matter_analyses_depth_idx" ON "matter_analyses" ("research_depth");
CREATE INDEX "matter_analyses_escalated_idx" ON "matter_analyses" ("escalated_at")
  WHERE "escalated_at" IS NOT NULL;

CREATE TABLE "matter_frame_flips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "matter_analysis_id" uuid NOT NULL REFERENCES "matter_analyses"("id") ON DELETE CASCADE,
  "proposed_by_stage" text NOT NULL,
  "from_frame" text,
  "to_frame" text NOT NULL,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "confidence" numeric(3,2),
  "lawyer_decision" "lawyer_decision" NOT NULL DEFAULT 'pending',
  "lawyer_decided_at" timestamp with time zone,
  "lawyer_decided_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "matter_frame_flips_matter_idx"
  ON "matter_frame_flips" ("matter_analysis_id", "created_at");
CREATE INDEX "matter_frame_flips_pending_idx"
  ON "matter_frame_flips" ("lawyer_decision")
  WHERE "lawyer_decision" = 'pending';
