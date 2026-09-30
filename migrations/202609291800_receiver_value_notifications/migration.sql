-- AlterTable
ALTER TABLE "MobileTopUpRecipient" ADD COLUMN     "language" TEXT;

-- AlterTable
ALTER TABLE "MobileTopUpQuote" ADD COLUMN     "receiverQuote" JSONB,
ALTER COLUMN "deliveredValue" SET DATA TYPE DECIMAL(24,8);

-- AlterTable
ALTER TABLE "MobileTopUpTransaction" ADD COLUMN     "receiverDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receiverLanguage" TEXT,
ADD COLUMN     "receiverQuote" JSONB,
ADD COLUMN     "receiverValueConfirmed" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "deliveredValue" SET DATA TYPE DECIMAL(24,8);

-- CreateTable
CREATE TABLE "RechargeNotification" (
    "transactionId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCategory" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "RechargeNotification_pkey" PRIMARY KEY ("transactionId")
);

-- CreateIndex
CREATE INDEX "RechargeNotification_status_createdAt_idx" ON "RechargeNotification"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "RechargeNotification" ADD CONSTRAINT "RechargeNotification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "MobileTopUpTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Do not backfill confirmed values or notifications from historical quote estimates.
ALTER TABLE "RechargeNotification"
  ADD CONSTRAINT "RechargeNotification_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED')),
  ADD CONSTRAINT "RechargeNotification_amount_check" CHECK ("amount" > 0 AND "amount" < 1000000000000),
  ADD CONSTRAINT "RechargeNotification_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "RechargeNotification_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
