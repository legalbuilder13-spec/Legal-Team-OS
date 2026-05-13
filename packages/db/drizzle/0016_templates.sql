-- Stage 4 template library (PRD §7.2.3 'Drafting from best practices').
-- Pre-authored boilerplate per practice_area + matter_type. The drafting
-- workspace shows a 'Start from template' dropdown filtered by the
-- matter's practice area; AI generation can then fill variables or
-- adjust tone on top of the chosen template.

CREATE TABLE "templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "practice_area" "practice_area" NOT NULL,
  "matter_type" text,
  "name" text NOT NULL,
  "body" text NOT NULL,
  "variables" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "last_used_at" timestamp with time zone,
  "use_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "templates_practice_area_idx" ON "templates" ("practice_area");
CREATE INDEX "templates_active_idx" ON "templates" ("is_active");
