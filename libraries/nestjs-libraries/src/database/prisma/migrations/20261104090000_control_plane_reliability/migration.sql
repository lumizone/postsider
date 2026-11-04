CREATE TYPE "PublishErrorCategory" AS ENUM ('AUTH_EXPIRED','PERMISSION_MISSING','RATE_LIMITED','INVALID_CONTENT','PROVIDER_UNAVAILABLE','UNKNOWN_OUTCOME','UNKNOWN');
CREATE TYPE "PublicWebhookDeliveryStatus" AS ENUM ('PENDING','SUCCEEDED','FAILED');

ALTER TABLE "Post"
  ADD COLUMN "errorCategory" "PublishErrorCategory",
  ADD COLUMN "errorRetryable" BOOLEAN,
  ADD COLUMN "publishAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastPublishAttemptAt" TIMESTAMP(3);

CREATE TABLE "PublicWebhookDelivery" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "PublicWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastStatusCode" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  CONSTRAINT "PublicWebhookDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PublicWebhookDelivery_status_nextAttemptAt_idx" ON "PublicWebhookDelivery"("status","nextAttemptAt");
CREATE INDEX "PublicWebhookDelivery_subscriptionId_createdAt_idx" ON "PublicWebhookDelivery"("subscriptionId","createdAt");
CREATE INDEX "PublicWebhookDelivery_createdAt_idx" ON "PublicWebhookDelivery"("createdAt");
ALTER TABLE "PublicWebhookDelivery" ADD CONSTRAINT "PublicWebhookDelivery_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "PublicWebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
