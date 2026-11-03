CREATE TABLE "PublicWebhookSubscription" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "events" TEXT[] NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "secretVersion" TEXT NOT NULL,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastDeliveryAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PublicWebhookSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicWebhookSubscription_organizationId_active_idx"
ON "PublicWebhookSubscription"("organizationId", "active");

CREATE INDEX "PublicWebhookSubscription_organizationId_createdAt_idx"
ON "PublicWebhookSubscription"("organizationId", "createdAt");

ALTER TABLE "PublicWebhookSubscription"
ADD CONSTRAINT "PublicWebhookSubscription_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
