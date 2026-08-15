-- Optional external-reviewer link for approval requests. Purely additive,
-- both columns nullable — no existing PostApproval row is affected.
ALTER TABLE "PostApproval" ADD COLUMN "guestToken" TEXT;
ALTER TABLE "PostApproval" ADD COLUMN "guestTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "PostApproval_guestToken_key" ON "PostApproval"("guestToken");
