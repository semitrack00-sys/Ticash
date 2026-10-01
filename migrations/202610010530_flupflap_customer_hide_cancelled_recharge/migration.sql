ALTER TABLE "MobileTopUpTransaction"
  ADD COLUMN "customerHiddenAt" TIMESTAMP(3);

CREATE INDEX "MobileTopUpTransaction_flupFlapCustomerId_customerHiddenAt_createdAt_idx"
  ON "MobileTopUpTransaction"("flupFlapCustomerId", "customerHiddenAt", "createdAt");
