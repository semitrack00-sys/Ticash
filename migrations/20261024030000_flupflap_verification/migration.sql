CREATE TABLE "FlupFlapVerificationChallenge" (
"id" TEXT PRIMARY KEY, "customerId" TEXT NOT NULL REFERENCES "FlupFlapCustomer"("id") ON DELETE CASCADE,
"channel" TEXT NOT NULL, "destination" TEXT NOT NULL, "codeHash" TEXT NOT NULL,
"attempts" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"expiresAt" TIMESTAMP(3) NOT NULL, "sentAt" TIMESTAMP(3), "consumedAt" TIMESTAMP(3));
CREATE INDEX "FlupFlapVerificationChallenge_customerId_channel_createdAt_idx"
ON "FlupFlapVerificationChallenge" ("customerId","channel","createdAt");
