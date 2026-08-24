-- Emergency Pause (Kill Switch): org-wide publishing pause.
-- - New PublishingState enum (ACTIVE | PAUSED), default ACTIVE so existing orgs are unaffected.
-- - New HELD state on the Post enum: a QUEUE post is parked to HELD when its org is paused,
--   and is only moved on resume (to DRAFT by default, or back to QUEUE).
-- - 3 nullable audit columns on Organization (who/when/why the pause was triggered).

ALTER TYPE "State" ADD VALUE 'HELD';

CREATE TYPE "PublishingState" AS ENUM ('ACTIVE', 'PAUSED');

ALTER TABLE "Organization" ADD COLUMN "publishingState" "PublishingState" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Organization" ADD COLUMN "publishingPausedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "publishingPausedById" TEXT;
ALTER TABLE "Organization" ADD COLUMN "publishingPauseReason" TEXT;
