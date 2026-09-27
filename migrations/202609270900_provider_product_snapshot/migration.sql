-- Nullable: historical records are retained; legacy plans require a fresh quote.
ALTER TABLE "MobileTopUpQuote" ADD COLUMN "productSnapshot" JSONB;
ALTER TABLE "MobileTopUpTransaction" ADD COLUMN "productSnapshot" JSONB;
