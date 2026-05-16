-- PR-6: absence spotter findings.
-- One row per fact the absence-spotter skill identifies as missing
-- but dispositive. Lawyer resolves with a value (the missing fact
-- known) or dismisses (model was wrong). Resolved findings feed the
-- matter request back into subsequent stage re-runs.

CREATE TABLE "matter_absence_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "matter_analysis_id" uuid NOT NULL REFERENCES "matter_analyses"("id") ON DELETE CASCADE,
  "missing_fact" text NOT NULL,
  "why_dispositive" text NOT NULL,
  "severity" text NOT NULL CHECK ("severity" IN ('high','medium','low')),
  "suggested_clarifying_question" text NOT NULL,
  "resolved" boolean NOT NULL DEFAULT false,
  "resolved_value" text,
  "resolved_at" timestamp with time zone,
  "resolved_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "dismissed" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "matter_absence_findings_matter_idx"
  ON "matter_absence_findings" ("matter_analysis_id", "severity");
CREATE INDEX "matter_absence_findings_open_idx"
  ON "matter_absence_findings" ("matter_analysis_id")
  WHERE "resolved" = false AND "dismissed" = false;
