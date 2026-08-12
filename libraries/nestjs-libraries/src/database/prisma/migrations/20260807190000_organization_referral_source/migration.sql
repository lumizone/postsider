-- Nullable "how did you hear about us" answer, collected on the onboarding
-- flow's attribution step. Saved (not just displayed and discarded, unlike
-- the pre-2026-08-06 onboarding's identical question).
ALTER TABLE "Organization" ADD COLUMN "referralSource" TEXT;
