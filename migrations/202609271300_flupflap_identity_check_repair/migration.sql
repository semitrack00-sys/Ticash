-- Restore the missing CHECK constraints that were created by the FlupFlap identity migration but not present in the drifted production database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FlupFlapCustomer_status_check') THEN
    ALTER TABLE "FlupFlapCustomer"
      ADD CONSTRAINT "FlupFlapCustomer_status_check" CHECK ("status" IN ('ACTIVE','SUSPENDED','CLOSED'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FlupFlapCustomer_credentials_check') THEN
    ALTER TABLE "FlupFlapCustomer"
      ADD CONSTRAINT "FlupFlapCustomer_credentials_check" CHECK (
        ("guestExpiresAt" IS NOT NULL AND "email" IS NULL AND "passwordHash" IS NULL) OR
        ("guestExpiresAt" IS NULL AND "email" IS NOT NULL AND "passwordHash" IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FlupFlapCustomer_email_normalized') THEN
    ALTER TABLE "FlupFlapCustomer"
      ADD CONSTRAINT "FlupFlapCustomer_email_normalized" CHECK ("email" = lower(trim("email")));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MobileTopUpRecipient_exactly_one_owner') THEN
    ALTER TABLE "MobileTopUpRecipient"
      ADD CONSTRAINT "MobileTopUpRecipient_exactly_one_owner" CHECK (("userId" IS NOT NULL) <> ("flupFlapCustomerId" IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MobileTopUpQuote_exactly_one_owner') THEN
    ALTER TABLE "MobileTopUpQuote"
      ADD CONSTRAINT "MobileTopUpQuote_exactly_one_owner" CHECK (("userId" IS NOT NULL) <> ("flupFlapCustomerId" IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MobileTopUpTransaction_exactly_one_owner') THEN
    ALTER TABLE "MobileTopUpTransaction"
      ADD CONSTRAINT "MobileTopUpTransaction_exactly_one_owner" CHECK (("userId" IS NOT NULL) <> ("flupFlapCustomerId" IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_no_mixed_actor') THEN
    ALTER TABLE "AuditLog"
      ADD CONSTRAINT "AuditLog_no_mixed_actor" CHECK ("userId" IS NULL OR "flupFlapCustomerId" IS NULL);
  END IF;
END $$;
