-- Additive only. Existing payment statuses and legacy NULL metadata retain their meaning.
ALTER TYPE "MobileTopUpPaymentStatus" ADD VALUE IF NOT EXISTS 'SESSION_CREATED';
ALTER TYPE "MobileTopUpPaymentStatus" ADD VALUE IF NOT EXISTS 'CAPTURED';
ALTER TYPE "MobileTopUpPaymentStatus" ADD VALUE IF NOT EXISTS 'VOID_PENDING';
ALTER TYPE "MobileTopUpPaymentStatus" ADD VALUE IF NOT EXISTS 'VOIDED';
ALTER TYPE "MobileTopUpPaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_PENDING';

CREATE TYPE "MobileTopUpPaymentMethod" AS ENUM ('CARD', 'APPLE_PAY', 'GOOGLE_PAY', 'BANK_ACCOUNT');
CREATE TYPE "MobileTopUpPaymentProviderName" AS ENUM ('MOCK', 'CHECKOUT_COM', 'DWOLLA');

ALTER TABLE "MobileTopUpTransaction"
  ADD COLUMN "paymentMethod" "MobileTopUpPaymentMethod",
  ADD COLUMN "paymentProvider" "MobileTopUpPaymentProviderName",
  ADD COLUMN "paymentSessionId" TEXT,
  ADD COLUMN "paymentProviderTransactionId" TEXT,
  ADD COLUMN "paymentStartedAt" TIMESTAMP(3),
  ADD COLUMN "fulfillmentStartedAt" TIMESTAMP(3),
  ADD COLUMN "recoveryStartedAt" TIMESTAMP(3),
  ADD COLUMN "paymentRecoveryCode" TEXT;

CREATE UNIQUE INDEX "MobileTopUpTransaction_paymentProvider_paymentSessionId_key"
  ON "MobileTopUpTransaction"("paymentProvider", "paymentSessionId");
CREATE UNIQUE INDEX "MobileTopUpTransaction_paymentProvider_paymentProviderTrans_key"
  ON "MobileTopUpTransaction"("paymentProvider", "paymentProviderTransactionId");
CREATE INDEX "MobileTopUpTransaction_paymentStatus_updatedAt_idx"
  ON "MobileTopUpTransaction"("paymentStatus", "updatedAt");

CREATE TABLE "MobileTopUpPaymentEvent" (
  "id" TEXT NOT NULL,
  "provider" "MobileTopUpPaymentProviderName" NOT NULL,
  "eventId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MobileTopUpPaymentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MobileTopUpPaymentEvent_transactionId_fkey" FOREIGN KEY ("transactionId")
    REFERENCES "MobileTopUpTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MobileTopUpPaymentEvent_provider_eventId_key" ON "MobileTopUpPaymentEvent"("provider", "eventId");
CREATE INDEX "MobileTopUpPaymentEvent_transactionId_createdAt_idx" ON "MobileTopUpPaymentEvent"("transactionId", "createdAt");
