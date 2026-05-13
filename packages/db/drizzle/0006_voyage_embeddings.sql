-- Switch embeddings from OpenAI text-embedding-3-small (1536 dims) to
-- Voyage AI's voyage-law-2 (1024 dims). Voyage is Anthropic's official
-- embeddings partner (Anthropic acquired Voyage in 2024) and voyage-law-2
-- is specifically optimized for legal text — material quality improvement
-- over general-purpose embedding models for contracts, statutes, and
-- case law.
--
-- The matters.embedding column has been NULL on all rows up to this point
-- (OPENAI_API_KEY was never set on the worker), so DROP + ADD is safe
-- with no data loss. After this migration ships, admin /admin/system
-- 'Backfill missing embeddings' button enqueues generate_embedding jobs
-- that populate the column at the new dimensionality.

ALTER TABLE "matters" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "matters" ADD COLUMN "embedding" vector(1024);
