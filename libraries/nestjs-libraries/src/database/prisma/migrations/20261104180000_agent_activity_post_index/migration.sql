CREATE INDEX CONCURRENTLY IF NOT EXISTS "Post_organizationId_state_updatedAt_idx" ON "Post"("organizationId", "state", "updatedAt");
