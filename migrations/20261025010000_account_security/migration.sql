-- CreateTable
CREATE TABLE "SecurityChallenge" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "binding" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlupFlapTrustedDevice" (
    "tokenHash" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlupFlapTrustedDevice_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "AdminMfa" (
    "userId" TEXT NOT NULL,
    "secretEncrypted" TEXT,
    "pendingEncrypted" TEXT,
    "pendingUntil" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3),
    "lastCounter" INTEGER NOT NULL DEFAULT -1,
    "recoveryHashes" JSONB NOT NULL DEFAULT '[]',
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "AdminMfa_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AdminMfaGrant" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessHash" TEXT NOT NULL,
    "passwordBinding" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminMfaGrant_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "SecurityChallenge_ownerId_purpose_createdAt_idx" ON "SecurityChallenge"("ownerId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityChallenge_expiresAt_idx" ON "SecurityChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "FlupFlapTrustedDevice_customerId_idx" ON "FlupFlapTrustedDevice"("customerId");

-- CreateIndex
CREATE INDEX "AdminMfaGrant_userId_idx" ON "AdminMfaGrant"("userId");

-- CreateIndex
CREATE INDEX "AdminMfaGrant_expiresAt_idx" ON "AdminMfaGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "FlupFlapTrustedDevice" ADD CONSTRAINT "FlupFlapTrustedDevice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminMfa" ADD CONSTRAINT "AdminMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminMfaGrant" ADD CONSTRAINT "AdminMfaGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

