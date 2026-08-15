CREATE TABLE "PostAnalytics" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PostAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostAnalytics_organizationId_postId_metric_measuredAt_key"
ON "PostAnalytics"("organizationId", "postId", "metric", "measuredAt");
CREATE INDEX "PostAnalytics_organizationId_postId_idx"
ON "PostAnalytics"("organizationId", "postId");
CREATE INDEX "PostAnalytics_measuredAt_idx" ON "PostAnalytics"("measuredAt");

ALTER TABLE "PostAnalytics" ADD CONSTRAINT "PostAnalytics_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostAnalytics" ADD CONSTRAINT "PostAnalytics_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
