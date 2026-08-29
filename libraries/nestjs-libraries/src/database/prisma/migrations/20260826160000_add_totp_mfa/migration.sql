ALTER TABLE "User" ADD COLUMN "mfaSecret" TEXT, ADD COLUMN "mfaPendingSecret" TEXT, ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);

CREATE TABLE "MfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MfaPolicy" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enforceForAll" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaPolicy_pkey" PRIMARY KEY ("id")
);

INSERT INTO "MfaPolicy" ("id", "enforceForAll") VALUES ('global', false);
