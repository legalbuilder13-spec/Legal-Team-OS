-- PR10 §6.1 — explicit accept/reject controls per stage. Currently the
-- pipeline tracks whether the worker completed a stage row, but not
-- whether the lawyer accepted the result. This makes "<15% override
-- rate on matched verdicts" (PRD §20.1 launch gate) computable from
-- the audit trail, and sharpens the acceptance signal in the
-- tool-suggestion intelligence (PR8 used a proxy).

CREATE TYPE "lawyer_decision" AS ENUM (
  'pending',
  'accepted',
  'rejected',
  'escalated'
);

ALTER TABLE "matter_analysis_stages"
  ADD COLUMN "lawyer_decision" "lawyer_decision" NOT NULL DEFAULT 'pending',
  ADD COLUMN "lawyer_decision_reason" text,
  ADD COLUMN "lawyer_decided_at" timestamp with time zone,
  ADD COLUMN "lawyer_decided_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX "matter_analysis_stages_decision_idx"
  ON "matter_analysis_stages" ("lawyer_decision");
