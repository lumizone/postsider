-- Who performed an audited action. Nullable: machine-driven entries (inbound
-- events, cron) have no actor, and every row written before this migration
-- predates actor tracking.
ALTER TABLE "AuditLog" ADD COLUMN "actorUserId" TEXT;

CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
