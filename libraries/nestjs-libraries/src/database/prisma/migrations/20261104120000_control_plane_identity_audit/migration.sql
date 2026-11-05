CREATE TYPE "PostActorType" AS ENUM ('USER','API_KEY','OAUTH_CLIENT','SYSTEM');

ALTER TABLE "Post"
  ADD COLUMN "createdByType" "PostActorType",
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "createdByApiKeyId" TEXT,
  ADD COLUMN "createdByOAuthClientId" TEXT,
  ADD COLUMN "lastModifiedByType" "PostActorType",
  ADD COLUMN "lastModifiedByUserId" TEXT,
  ADD COLUMN "lastModifiedByApiKeyId" TEXT,
  ADD COLUMN "lastModifiedByOAuthClientId" TEXT,
  ADD COLUMN "agentName" VARCHAR(255),
  ADD COLUMN "workflowId" VARCHAR(255),
  ADD COLUMN "runId" VARCHAR(255),
  ADD COLUMN "externalRef" VARCHAR(255),
  ADD COLUMN "source" VARCHAR(255);

ALTER TABLE "PostApproval"
  ADD COLUMN "requestedByType" "PostActorType",
  ADD COLUMN "requestedByUserId" TEXT,
  ADD COLUMN "requestedByApiKeyId" TEXT,
  ADD COLUMN "requestedByOAuthClientId" TEXT,
  ADD COLUMN "decidedByType" "PostActorType",
  ADD COLUMN "guestName" VARCHAR(120),
  ADD COLUMN "guestEmail" VARCHAR(254);

ALTER TABLE "AuditLog"
  ADD COLUMN "targetType" TEXT,
  ADD COLUMN "targetId" TEXT,
  ADD COLUMN "actorType" "PostActorType",
  ADD COLUMN "actorApiKeyId" TEXT,
  ADD COLUMN "actorOAuthClientId" TEXT,
  ADD COLUMN "metadata" JSONB;

CREATE INDEX "AuditLog_organizationId_targetType_targetId_createdAt_idx"
  ON "AuditLog"("organizationId","targetType","targetId","createdAt");
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId","createdAt");
