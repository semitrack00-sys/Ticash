CREATE TABLE "RechargeFraudAssessment" (
 "transactionId" TEXT PRIMARY KEY, "customerId" TEXT NOT NULL,
 "fingerprint" TEXT, "chargeId" TEXT, "risk" TEXT NOT NULL,
 "authentication" TEXT, "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RechargeFraudAssessment_customerId_createdAt_idx" ON "RechargeFraudAssessment"("customerId", "createdAt");
CREATE INDEX "RechargeFraudAssessment_fingerprint_createdAt_idx" ON "RechargeFraudAssessment"("fingerprint", "createdAt");
