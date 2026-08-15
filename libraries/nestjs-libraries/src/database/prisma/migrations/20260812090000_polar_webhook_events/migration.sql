CREATE TABLE "PolarWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolarWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PolarWebhookEvent_eventId_key" ON "PolarWebhookEvent"("eventId");
CREATE INDEX "PolarWebhookEvent_processedAt_idx" ON "PolarWebhookEvent"("processedAt");
CREATE INDEX "PolarWebhookEvent_eventType_idx" ON "PolarWebhookEvent"("eventType");
