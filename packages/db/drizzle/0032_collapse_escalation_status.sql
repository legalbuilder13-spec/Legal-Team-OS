-- Collapse escalation_status from {open, acknowledged, resolved} to {open, resolved}.
-- The acknowledge step was a queue-claim signal designed for multi-lawyer
-- teams. In current usage it adds friction without value — there is no
-- meaningful difference between "I saw this" and "I'm working on this":
-- if the lawyer is going to act, they resolve; if not, leaving it open is
-- correct. Drop the intermediate state and the actor/timestamp columns
-- that backed it.
--
-- Existing `acknowledged` rows roll back to `open` so they re-surface in
-- the queue and the owner has to explicitly resolve them.

-- 1. Roll any acknowledged rows back to open before we swap the enum.
UPDATE "escalations" SET "status" = 'open' WHERE "status" = 'acknowledged';

-- 2. Postgres can't remove an enum value in place. Standard pattern: build
--    a new enum, swap the column to it via USING, drop the old enum,
--    rename the new one back.
CREATE TYPE "escalation_status_new" AS ENUM ('open', 'resolved');

ALTER TABLE "escalations"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "escalations"
  ALTER COLUMN "status" TYPE "escalation_status_new"
  USING ("status"::text::"escalation_status_new");

ALTER TABLE "escalations"
  ALTER COLUMN "status" SET DEFAULT 'open';

DROP TYPE "escalation_status";
ALTER TYPE "escalation_status_new" RENAME TO "escalation_status";

-- 3. Drop the columns that only existed to record who/when acknowledged.
ALTER TABLE "escalations" DROP COLUMN IF EXISTS "acknowledged_by_id";
ALTER TABLE "escalations" DROP COLUMN IF EXISTS "acknowledged_at";
