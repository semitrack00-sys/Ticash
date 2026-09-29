CREATE TYPE "MobileTopUpEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

ALTER TABLE "MobileTopUpTransaction"
  ADD COLUMN "paymentEnvironment" "MobileTopUpEnvironment" NOT NULL DEFAULT 'SANDBOX',
  ADD COLUMN "rechargeEnvironment" "MobileTopUpEnvironment" NOT NULL DEFAULT 'SANDBOX';

ALTER TABLE "MobileTopUpTransaction"
  ADD CONSTRAINT "MobileTopUpTransaction_payment_recharge_environment_match"
  CHECK ("paymentEnvironment" = "rechargeEnvironment");

ALTER TABLE "MobileTopUpTransaction"
  ADD CONSTRAINT "MobileTopUpTransaction_environment_testmode_match"
  CHECK (
    ("paymentEnvironment" = 'SANDBOX' AND "testMode" = true)
    OR
    ("paymentEnvironment" = 'PRODUCTION' AND "testMode" = false)
  );

DROP INDEX IF EXISTS "MobileTopUpTransaction_provider_providerTransactionId_key";
CREATE UNIQUE INDEX "MTopUpTx_provider_rechargeEnv_providerTxnId_key"
  ON "MobileTopUpTransaction"("provider", "rechargeEnvironment", "providerTransactionId");

DROP INDEX IF EXISTS "MobileTopUpTransaction_paymentProvider_paymentSessionId_key";
CREATE UNIQUE INDEX "MTopUpTx_payProv_payEnv_paySessionId_key"
  ON "MobileTopUpTransaction"("paymentProvider", "paymentEnvironment", "paymentSessionId");

DROP INDEX IF EXISTS "MobileTopUpTransaction_paymentProvider_paymentProviderTransactionId_key";
CREATE UNIQUE INDEX "MTopUpTx_payProv_payEnv_payProvTxnId_key"
  ON "MobileTopUpTransaction"("paymentProvider", "paymentEnvironment", "paymentProviderTransactionId");
