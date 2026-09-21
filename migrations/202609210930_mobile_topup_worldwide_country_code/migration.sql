ALTER TABLE "MobileTopUpTransaction"
ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'HT';

ALTER TABLE "MobileTopUpRecipient"
ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'HT';

ALTER TABLE "MobileTopUpRecipient"
DROP CONSTRAINT IF EXISTS "MobileTopUpRecipient_userId_phone_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MobileTopUpRecipient_userId_phone_countryCode_key'
  ) THEN
    ALTER TABLE "MobileTopUpRecipient"
    ADD CONSTRAINT "MobileTopUpRecipient_userId_phone_countryCode_key"
    UNIQUE ("userId", "phone", "countryCode");
  END IF;
END $$;
