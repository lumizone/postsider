ALTER TABLE "Webhooks" ADD COLUMN "secret" TEXT;

CREATE TABLE "PublicApiIdempotency" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "responseJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicApiIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicApiIdempotency_organizationId_key_key"
  ON "PublicApiIdempotency"("organizationId", "key");
CREATE INDEX "PublicApiIdempotency_createdAt_idx"
  ON "PublicApiIdempotency"("createdAt");
CREATE INDEX "PublicApiIdempotency_organizationId_idx"
  ON "PublicApiIdempotency"("organizationId");
