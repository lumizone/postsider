CREATE TABLE "FunnelAttribution" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "journeyId" VARCHAR(36),
  "landingPath" VARCHAR(181),
  "referrerHost" VARCHAR(120),
  "utmSource" VARCHAR(90),
  "utmMedium" VARCHAR(90),
  "utmCampaign" VARCHAR(90),
  "utmContent" VARCHAR(90),
  "utmTerm" VARCHAR(90),
  "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "signupCompletedAt" TIMESTAMP(3),
  "onboardingIntent" VARCHAR(15),
  "onboardingTypeSelectedAt" TIMESTAMP(3),
  "mcpConnectedAt" TIMESTAMP(3),
  "firstDraftCreatedAt" TIMESTAMP(3),
  "subscriptionStartedAt" TIMESTAMP(3),
  "firstPaidTier" VARCHAR(20),
  "firstPaidCurrency" VARCHAR(3),
  "firstPaidAmount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FunnelAttribution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FunnelAttribution_organizationId_key" ON "FunnelAttribution"("organizationId");
CREATE INDEX "FunnelAttribution_subscriptionStartedAt_idx" ON "FunnelAttribution"("subscriptionStartedAt");
CREATE INDEX "FunnelAttribution_utmSource_utmCampaign_idx" ON "FunnelAttribution"("utmSource", "utmCampaign");
ALTER TABLE "FunnelAttribution" ADD CONSTRAINT "FunnelAttribution_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
