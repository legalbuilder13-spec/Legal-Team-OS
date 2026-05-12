-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add generate_embedding to job_kind enum
ALTER TYPE "public"."job_kind" ADD VALUE 'generate_embedding';

-- Create playbooks table
CREATE TABLE "playbooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "practice_area" "practice_area" NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "playbooks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
);

CREATE INDEX "playbooks_practice_area_idx" ON "playbooks" ("practice_area");

-- Add embedding column to matters
ALTER TABLE "matters" ADD COLUMN "embedding" vector(1536);
