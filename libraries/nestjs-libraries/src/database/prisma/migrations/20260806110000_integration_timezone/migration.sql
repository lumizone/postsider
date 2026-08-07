-- Integration.postingTimes.time is reinterpreted as minutes-from-midnight in
-- THIS new `timezone` column (IANA name), not UTC. Default 'UTC' means every
-- existing channel keeps EXACTLY the same resolved schedule as before this
-- migration (local time == UTC time when the zone is UTC) — this is purely
-- additive/backward-compatible, not a data migration.
ALTER TABLE "Integration" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
