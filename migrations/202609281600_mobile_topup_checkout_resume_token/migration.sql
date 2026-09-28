ALTER TABLE "MobileTopUpTransaction"
  ADD COLUMN "checkoutResumeTokenHash" TEXT,
  ADD COLUMN "checkoutResumeTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "MobileTopUpTransaction_checkoutResumeTokenHash_key"
  ON "MobileTopUpTransaction"("checkoutResumeTokenHash");
