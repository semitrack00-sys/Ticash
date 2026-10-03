ALTER TABLE "MobileTopUpTransaction" ADD COLUMN "recurringIntervalDays" INTEGER;
ALTER TABLE "MobileTopUpTransaction" ADD CONSTRAINT "MobileTopUpTransaction_recurringIntervalDays_check"
  CHECK ("recurringIntervalDays" IS NULL OR "recurringIntervalDays" IN (7,15,30));

-- FlupFlap automatic recurring recharge schedules.
-- Stores only Stripe object identifiers; no PAN/CVV/card secrets are stored.
CREATE TABLE "FlupFlapRecurringRecharge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "sourceTransactionId" TEXT NOT NULL,
  "intervalDays" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "maxTotalUsd" DECIMAL(18,2) NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "stripePaymentMethodId" TEXT NOT NULL,
  "billingCountry" TEXT NOT NULL,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "pendingOccurrenceAt" TIMESTAMP(3),
  "pendingQuoteId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "lastTransactionId" TEXT,
  "lastRunAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FlupFlapRecurringRecharge_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FlupFlapRecurringRecharge_intervalDays_check" CHECK ("intervalDays" IN (7,15,30)),
  CONSTRAINT "FlupFlapRecurringRecharge_status_check" CHECK ("status" IN ('ACTIVE','PAUSED','CANCELLED')),
  CONSTRAINT "FlupFlapRecurringRecharge_billingCountry_check" CHECK ("billingCountry" ~ '^[A-Z]{2}$'),
  CONSTRAINT "FlupFlapRecurringRecharge_stripeCustomer_check" CHECK ("stripeCustomerId" ~ '^cus_[A-Za-z0-9_]+$'),
  CONSTRAINT "FlupFlapRecurringRecharge_stripePaymentMethod_check" CHECK ("stripePaymentMethodId" ~ '^pm_[A-Za-z0-9_]+$'),
  CONSTRAINT "FlupFlapRecurringRecharge_maxTotalUsd_check" CHECK ("maxTotalUsd" > 0)
);

CREATE INDEX "FlupFlapRecurringRecharge_status_nextRunAt_idx"
  ON "FlupFlapRecurringRecharge"("status","nextRunAt");
CREATE INDEX "FlupFlapRecurringRecharge_customerId_createdAt_idx"
  ON "FlupFlapRecurringRecharge"("customerId","createdAt");

CREATE UNIQUE INDEX "FlupFlapRecurringRecharge_customerId_sourceTransactionId_key"
  ON "FlupFlapRecurringRecharge"("customerId","sourceTransactionId");
