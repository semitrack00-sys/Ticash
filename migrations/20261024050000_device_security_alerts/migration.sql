CREATE TABLE "FlupFlapDevice" ("deviceHash" TEXT NOT NULL, "customerId" TEXT NOT NULL, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("deviceHash", "customerId"));
CREATE INDEX "FlupFlapDevice_lastSeenAt_idx" ON "FlupFlapDevice"("lastSeenAt");
CREATE INDEX "FlupFlapDevice_customerId_idx" ON "FlupFlapDevice"("customerId");
CREATE TABLE "FlupFlapFraudAlert" ("transactionId" TEXT NOT NULL PRIMARY KEY, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "claimedAt" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0, "sentAt" TIMESTAMP(3), "lastError" TEXT);
CREATE INDEX "FlupFlapFraudAlert_sentAt_createdAt_idx" ON "FlupFlapFraudAlert"("sentAt", "createdAt");
