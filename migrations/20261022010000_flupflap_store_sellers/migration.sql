-- AlterEnum
ALTER TYPE "MobileTopUpPaymentProviderName" ADD VALUE 'STORE_BALANCE';

-- CreateTable
CREATE TABLE "FlupFlapStore" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "commissionBps" INTEGER NOT NULL DEFAULT 2000,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlupFlapStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlupFlapStoreFunding" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "FlupFlapStoreFunding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlupFlapStoreOrder" (
    "transactionId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlupFlapStoreOrder_pkey" PRIMARY KEY ("transactionId")
);

-- CreateTable
CREATE TABLE "FlupFlapStoreEntry" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlupFlapStoreEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlupFlapStore_status_createdAt_idx" ON "FlupFlapStore"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlupFlapStore_customerId_testMode_key" ON "FlupFlapStore"("customerId", "testMode");

-- CreateIndex
CREATE UNIQUE INDEX "FlupFlapStoreFunding_reference_key" ON "FlupFlapStoreFunding"("reference");

-- CreateIndex
CREATE INDEX "FlupFlapStoreFunding_storeId_createdAt_idx" ON "FlupFlapStoreFunding"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "FlupFlapStoreOrder_storeId_createdAt_idx" ON "FlupFlapStoreOrder"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlupFlapStoreEntry_reference_key" ON "FlupFlapStoreEntry"("reference");

-- CreateIndex
CREATE INDEX "FlupFlapStoreEntry_storeId_createdAt_idx" ON "FlupFlapStoreEntry"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "FlupFlapStore" ADD CONSTRAINT "FlupFlapStore_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlupFlapStoreFunding" ADD CONSTRAINT "FlupFlapStoreFunding_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "FlupFlapStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlupFlapStoreOrder" ADD CONSTRAINT "FlupFlapStoreOrder_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "MobileTopUpTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlupFlapStoreOrder" ADD CONSTRAINT "FlupFlapStoreOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "FlupFlapStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlupFlapStoreEntry" ADD CONSTRAINT "FlupFlapStoreEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "FlupFlapStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "FlupFlapStore" ADD CONSTRAINT "store_status" CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REJECTED')),
  ADD CONSTRAINT "store_commission" CHECK ("commissionBps" BETWEEN 0 AND 5000),
  ADD CONSTRAINT "store_balance_nonnegative" CHECK ("balanceCents" >= 0);
ALTER TABLE "FlupFlapStoreFunding" ADD CONSTRAINT "store_funding_amount" CHECK ("amountCents" BETWEEN 100 AND 1000000),
  ADD CONSTRAINT "store_funding_status" CHECK (status IN ('PENDING','APPROVED','REJECTED'));
ALTER TABLE "FlupFlapStoreOrder" ADD CONSTRAINT "store_order_amounts" CHECK
  ("totalCents" > 0 AND "totalCents" <= 1000000 AND "feeCents" BETWEEN 0 AND "totalCents" AND "commissionCents" BETWEEN 0 AND "feeCents" AND "commissionBps" BETWEEN 0 AND 5000),
  ADD CONSTRAINT "store_order_status" CHECK (status IN ('HELD','DELIVERED','REFUNDED'));
ALTER TABLE "FlupFlapStoreEntry" ADD CONSTRAINT "store_entry_balance" CHECK ("balanceAfterCents" >= 0),
  ADD CONSTRAINT "store_entry_kind" CHECK (kind IN ('DEPOSIT','RECHARGE','COMMISSION','REFUND','BALANCE_RETURN'));
CREATE FUNCTION reject_store_entry_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Store balance entries are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_store_entries BEFORE UPDATE OR DELETE ON "FlupFlapStoreEntry"
FOR EACH ROW EXECUTE FUNCTION reject_store_entry_mutation();
