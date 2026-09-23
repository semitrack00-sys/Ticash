-- Additive only. Existing Reloadly quotes/transactions retain their provider defaults.
ALTER TYPE "MobileTopUpProviderName" ADD VALUE 'DTONE';
ALTER TABLE "MobileTopUpRecipient" ADD COLUMN "provider" "MobileTopUpProviderName";
ALTER TABLE "MobileTopUpQuote" ADD COLUMN "providerProductId" TEXT;
ALTER TABLE "MobileTopUpTransaction" ADD COLUMN "providerProductId" TEXT;
-- All operator selections created before routing used Reloadly's original IDs.
UPDATE "MobileTopUpRecipient" SET "provider" = 'RELOADLY' WHERE "operatorId" IS NOT NULL;
