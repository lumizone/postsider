-- CreateEnum
CREATE TYPE "PostAction" AS ENUM ('DRAFT', 'SCHEDULE', 'PUBLISH_NOW');

-- CreateEnum
CREATE TYPE "PolicyCondition" AS ENUM ('ALWAYS', 'CONTAINS_LINK', 'CONTAINS_WORDS', 'OUTSIDE_WINDOW', 'DAILY_CAP_EXCEEDED', 'PUBLISH_NOW', 'HAS_VIDEO');

-- CreateEnum
CREATE TYPE "PolicyEffect" AS ENUM ('REQUIRE_APPROVAL', 'BLOCK');

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "allowedActions" "PostAction"[] NOT NULL DEFAULT ARRAY[]::"PostAction"[],
ADD COLUMN "allowedIntegrationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "appliesToActorTypes" "PostActorType"[] NOT NULL DEFAULT ARRAY[]::"PostActorType"[],
    "appliesToApiKeyIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "appliesToIntegrationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "appliesToProviders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "condition" "PolicyCondition" NOT NULL,
    "conditionParams" JSONB NOT NULL DEFAULT '{}',
    "effect" "PolicyEffect" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PolicyRule_organizationId_deletedAt_enabled_idx" ON "PolicyRule"("organizationId", "deletedAt", "enabled");

-- AddForeignKey
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
