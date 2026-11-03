-- CreateTable
CREATE TABLE "McpOAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
    "clientSecret" TEXT,
    "registrationIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpOAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthPendingAuthorization" (
    "id" TEXT NOT NULL,
    "mcpOAuthClientId" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "scopes" TEXT[],
    "state" TEXT,
    "redirectUri" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "McpOAuthPendingAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "mcpOAuthClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopes" TEXT[],
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "redirectUri" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "McpOAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthGrant" (
    "id" TEXT NOT NULL,
    "mcpOAuthClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "McpOAuthGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthAccessToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "McpOAuthAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthRefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,

    CONSTRAINT "McpOAuthRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthClient_clientId_key" ON "McpOAuthClient"("clientId");

-- CreateIndex
CREATE INDEX "McpOAuthClient_createdAt_idx" ON "McpOAuthClient"("createdAt");

-- CreateIndex
CREATE INDEX "McpOAuthPendingAuthorization_mcpOAuthClientId_idx" ON "McpOAuthPendingAuthorization"("mcpOAuthClientId");

-- CreateIndex
CREATE INDEX "McpOAuthPendingAuthorization_expiresAt_idx" ON "McpOAuthPendingAuthorization"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthCode_codeHash_key" ON "McpOAuthCode"("codeHash");

-- CreateIndex
CREATE INDEX "McpOAuthCode_mcpOAuthClientId_idx" ON "McpOAuthCode"("mcpOAuthClientId");

-- CreateIndex
CREATE INDEX "McpOAuthCode_userId_idx" ON "McpOAuthCode"("userId");

-- CreateIndex
CREATE INDEX "McpOAuthCode_organizationId_idx" ON "McpOAuthCode"("organizationId");

-- CreateIndex
CREATE INDEX "McpOAuthCode_expiresAt_idx" ON "McpOAuthCode"("expiresAt");

-- CreateIndex
CREATE INDEX "McpOAuthGrant_userId_idx" ON "McpOAuthGrant"("userId");

-- CreateIndex
CREATE INDEX "McpOAuthGrant_organizationId_idx" ON "McpOAuthGrant"("organizationId");

-- CreateIndex
CREATE INDEX "McpOAuthGrant_revokedAt_idx" ON "McpOAuthGrant"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthGrant_mcpOAuthClientId_userId_organizationId_key" ON "McpOAuthGrant"("mcpOAuthClientId", "userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthAccessToken_tokenHash_key" ON "McpOAuthAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "McpOAuthAccessToken_grantId_idx" ON "McpOAuthAccessToken"("grantId");

-- CreateIndex
CREATE INDEX "McpOAuthAccessToken_expiresAt_idx" ON "McpOAuthAccessToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthRefreshToken_tokenHash_key" ON "McpOAuthRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "McpOAuthRefreshToken_grantId_idx" ON "McpOAuthRefreshToken"("grantId");

-- CreateIndex
CREATE INDEX "McpOAuthRefreshToken_expiresAt_idx" ON "McpOAuthRefreshToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "McpOAuthPendingAuthorization" ADD CONSTRAINT "McpOAuthPendingAuthorization_mcpOAuthClientId_fkey" FOREIGN KEY ("mcpOAuthClientId") REFERENCES "McpOAuthClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthCode" ADD CONSTRAINT "McpOAuthCode_mcpOAuthClientId_fkey" FOREIGN KEY ("mcpOAuthClientId") REFERENCES "McpOAuthClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthCode" ADD CONSTRAINT "McpOAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthCode" ADD CONSTRAINT "McpOAuthCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthGrant" ADD CONSTRAINT "McpOAuthGrant_mcpOAuthClientId_fkey" FOREIGN KEY ("mcpOAuthClientId") REFERENCES "McpOAuthClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthGrant" ADD CONSTRAINT "McpOAuthGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthGrant" ADD CONSTRAINT "McpOAuthGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthAccessToken" ADD CONSTRAINT "McpOAuthAccessToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "McpOAuthGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthRefreshToken" ADD CONSTRAINT "McpOAuthRefreshToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "McpOAuthGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

