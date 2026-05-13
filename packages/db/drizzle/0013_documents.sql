-- Stage 4 document ingestion (PRD §7.3). Counterparty-supplied contracts
-- (.docx / .pdf) are uploaded to a matter, parsed into structured clauses
-- via the AI service, and stored for downstream clause-level analysis
-- (E3 analyze-clause worker + E4 review UI).
--
-- matter_documents holds the original file + parse status.
-- matter_document_clauses holds the segmented clauses produced by the
-- parser. One document → N clauses, each with an ordinal position and
-- heading path for context.

CREATE TYPE "document_parse_status" AS ENUM ('pending', 'parsing', 'parsed', 'failed');

CREATE TABLE "matter_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "matter_id" uuid NOT NULL REFERENCES "matters"("id") ON DELETE CASCADE,
  "uploaded_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "content" bytea NOT NULL,
  "parse_status" "document_parse_status" NOT NULL DEFAULT 'pending',
  "parse_error" text,
  "parser_version" text,
  "clause_count" integer,
  "page_count" integer,
  "char_count" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "parsed_at" timestamp with time zone
);

CREATE INDEX "matter_documents_matter_idx" ON "matter_documents" ("matter_id", "created_at" DESC);
CREATE INDEX "matter_documents_status_idx" ON "matter_documents" ("parse_status");

CREATE TABLE "matter_document_clauses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "matter_documents"("id") ON DELETE CASCADE,
  "ordinal" integer NOT NULL,
  "heading_path" text,
  "clause_text" text NOT NULL,
  "char_start" integer NOT NULL,
  "char_end" integer NOT NULL,
  "page_number" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "matter_document_clauses_doc_ordinal_uq" UNIQUE ("document_id", "ordinal")
);

CREATE INDEX "matter_document_clauses_document_idx" ON "matter_document_clauses" ("document_id", "ordinal");

ALTER TYPE "job_kind" ADD VALUE IF NOT EXISTS 'parse_document';
