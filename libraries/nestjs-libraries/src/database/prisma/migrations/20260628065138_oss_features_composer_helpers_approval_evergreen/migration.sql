-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "CreationMethod" ADD VALUE 'CSV';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "evergreen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstComment" TEXT,
ADD COLUMN     "lastRecycledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HashtagGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashtags" TEXT NOT NULL,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HashtagGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptionTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtmPreset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "utmSource" TEXT NOT NULL,
    "utmMedium" TEXT NOT NULL,
    "utmCampaign" TEXT NOT NULL,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UtmPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostApproval" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvergreenSettings" (
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalDays" INTEGER NOT NULL DEFAULT 7,
    "maxPerRun" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvergreenSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE INDEX "HashtagGroup_organizationId_idx" ON "HashtagGroup"("organizationId");

-- CreateIndex
CREATE INDEX "CaptionTemplate_organizationId_idx" ON "CaptionTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "UtmPreset_organizationId_idx" ON "UtmPreset"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PostApproval_postId_key" ON "PostApproval"("postId");

-- CreateIndex
CREATE INDEX "PostApproval_organizationId_idx" ON "PostApproval"("organizationId");

-- CreateIndex
CREATE INDEX "PostApproval_status_idx" ON "PostApproval"("status");

-- CreateIndex
CREATE INDEX "PostApproval_requestedById_idx" ON "PostApproval"("requestedById");

-- AddForeignKey
ALTER TABLE "HashtagGroup" ADD CONSTRAINT "HashtagGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptionTemplate" ADD CONSTRAINT "CaptionTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtmPreset" ADD CONSTRAINT "UtmPreset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostApproval" ADD CONSTRAINT "PostApproval_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostApproval" ADD CONSTRAINT "PostApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostApproval" ADD CONSTRAINT "PostApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostApproval" ADD CONSTRAINT "PostApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvergreenSettings" ADD CONSTRAINT "EvergreenSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

