-- Optional per-channel scoping for USER-role members. No rows for a user
-- means unrestricted access (unchanged default behavior) — this table is
-- purely additive.
CREATE TABLE "ChannelAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelAssignment_userId_integrationId_key" ON "ChannelAssignment"("userId", "integrationId");
CREATE INDEX "ChannelAssignment_organizationId_idx" ON "ChannelAssignment"("organizationId");
CREATE INDEX "ChannelAssignment_integrationId_idx" ON "ChannelAssignment"("integrationId");
CREATE INDEX "ChannelAssignment_userId_idx" ON "ChannelAssignment"("userId");

ALTER TABLE "ChannelAssignment" ADD CONSTRAINT "ChannelAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelAssignment" ADD CONSTRAINT "ChannelAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelAssignment" ADD CONSTRAINT "ChannelAssignment_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
