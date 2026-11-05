-- AlterTable
ALTER TABLE "PolicyRule" ADD COLUMN     "approvalFlowId" TEXT;

-- AlterTable
ALTER TABLE "PostApproval" ADD COLUMN     "currentStage" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "decidedByApiKeyId" TEXT,
ADD COLUMN     "decidedByOAuthClientId" TEXT,
ADD COLUMN     "decidedVia" VARCHAR(20),
ADD COLUMN     "flowId" TEXT,
ADD COLUMN     "guestTokenHash" TEXT,
ADD COLUMN     "stageCount" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ApprovalFlow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "preventSelfApproval" BOOLEAN NOT NULL DEFAULT true,
    "requireDistinctApprovers" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalFlowStage" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "minRole" "Role" NOT NULL DEFAULT 'ADMIN',
    "approverUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowAutomation" BOOLEAN NOT NULL DEFAULT false,
    "allowGuest" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ApprovalFlowStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostApprovalStage" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "minRole" "Role" NOT NULL DEFAULT 'ADMIN',
    "approverUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowAutomation" BOOLEAN NOT NULL DEFAULT false,
    "allowGuest" BOOLEAN NOT NULL DEFAULT false,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByType" "PostActorType",
    "decidedByUserId" TEXT,
    "decidedByApiKeyId" TEXT,
    "decidedByOAuthClientId" TEXT,
    "decidedVia" VARCHAR(20),
    "note" VARCHAR(500),
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PostApprovalStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalActionToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "stagePosition" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalFlow_organizationId_deletedAt_idx" ON "ApprovalFlow"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalFlowStage_flowId_position_key" ON "ApprovalFlowStage"("flowId", "position");

-- CreateIndex
CREATE INDEX "PostApprovalStage_approvalId_idx" ON "PostApprovalStage"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "PostApprovalStage_approvalId_position_key" ON "PostApprovalStage"("approvalId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalActionToken_tokenHash_key" ON "ApprovalActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApprovalActionToken_approvalId_idx" ON "ApprovalActionToken"("approvalId");

-- CreateIndex
CREATE INDEX "ApprovalActionToken_expiresAt_idx" ON "ApprovalActionToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PolicyRule_approvalFlowId_idx" ON "PolicyRule"("approvalFlowId");

-- CreateIndex
CREATE UNIQUE INDEX "PostApproval_guestTokenHash_key" ON "PostApproval"("guestTokenHash");

-- AddForeignKey
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_approvalFlowId_fkey" FOREIGN KEY ("approvalFlowId") REFERENCES "ApprovalFlow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalFlow" ADD CONSTRAINT "ApprovalFlow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalFlowStage" ADD CONSTRAINT "ApprovalFlowStage_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "ApprovalFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostApprovalStage" ADD CONSTRAINT "PostApprovalStage_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "PostApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill step 1: hash existing plaintext guest tokens so already issued
-- guest links keep resolving (the service looks tokens up by SHA-256 hex).
UPDATE "PostApproval" SET "guestTokenHash" = encode(sha256(convert_to("guestToken", 'UTF8')), 'hex') WHERE "guestToken" IS NOT NULL;

-- Backfill step 2 (separate on purpose, MUST run after step 1): erase the
-- plaintext tokens. The "guestToken" column itself is kept for one release.
UPDATE "PostApproval" SET "guestToken" = NULL WHERE "guestToken" IS NOT NULL;
