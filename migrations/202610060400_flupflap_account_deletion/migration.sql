ALTER TABLE "FlupFlapCustomer" DROP CONSTRAINT "FlupFlapCustomer_status_check";
ALTER TABLE "FlupFlapCustomer" ADD CONSTRAINT "FlupFlapCustomer_status_check"
  CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED','DELETED'));
ALTER TABLE "FlupFlapCustomer" DROP CONSTRAINT "FlupFlapCustomer_credentials_check";
ALTER TABLE "FlupFlapCustomer" ADD CONSTRAINT "FlupFlapCustomer_credentials_check" CHECK (
  (status = 'DELETED' AND "email" IS NULL AND "passwordHash" IS NULL AND "googleSubject" IS NULL
    AND "firstName" IS NULL AND "lastName" IS NULL AND "phone" IS NULL AND "countryCode" IS NULL
    AND "guestExpiresAt" IS NULL AND "emailVerifiedAt" IS NULL AND "phoneVerifiedAt" IS NULL
    AND "lastLoginAt" IS NULL AND "loginLockedUntil" IS NULL AND "failedLoginAttempts" = 0
    AND "rechargeRestricted") OR
  (status <> 'DELETED' AND (("guestExpiresAt" IS NOT NULL AND "email" IS NULL AND "passwordHash" IS NULL) OR
    ("guestExpiresAt" IS NULL AND "email" IS NOT NULL AND "passwordHash" IS NOT NULL)))
);

CREATE FUNCTION flupflap_deleted_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'DELETED' AND NEW.status <> 'DELETED' THEN
    RAISE EXCEPTION 'Deleted identity cannot be reactivated';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FlupFlapCustomer_deleted_immutable" BEFORE UPDATE ON "FlupFlapCustomer"
  FOR EACH ROW EXECUTE FUNCTION flupflap_deleted_identity_immutable();

-- A concurrent insert waits for the erasure transaction, then rejects the deleted identity.
CREATE FUNCTION flupflap_reject_deleted_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT; owner_status TEXT;
BEGIN
  owner_id := to_jsonb(NEW)->>TG_ARGV[0];
  IF owner_id IS NOT NULL THEN
    -- Use the same exclusive lock as quote promotion reservation, avoiding a
    -- shared-to-exclusive lock upgrade deadlock between same-customer quotes.
    SELECT status INTO owner_status FROM "FlupFlapCustomer" WHERE id = owner_id FOR UPDATE;
    IF owner_status = 'DELETED' THEN RAISE EXCEPTION 'Deleted FlupFlap identity'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FlupFlapSession_deleted_guard" BEFORE INSERT ON "FlupFlapSession"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('customerId');
CREATE TRIGGER "FlupFlapPasswordResetToken_deleted_guard" BEFORE INSERT ON "FlupFlapPasswordResetToken"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('customerId');
CREATE TRIGGER "MobileTopUpRecipient_deleted_guard" BEFORE INSERT ON "MobileTopUpRecipient"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('flupFlapCustomerId');
CREATE TRIGGER "MobileTopUpQuote_deleted_guard" BEFORE INSERT ON "MobileTopUpQuote"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('flupFlapCustomerId');
CREATE TRIGGER "MobileTopUpTransaction_deleted_guard" BEFORE INSERT ON "MobileTopUpTransaction"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('flupFlapCustomerId');
CREATE TRIGGER "FlupFlapRecurringRecharge_deleted_guard" BEFORE INSERT ON "FlupFlapRecurringRecharge"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('customerId');
CREATE TRIGGER "ReferralAttribution_deleted_guard" BEFORE INSERT ON "ReferralAttribution"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('customerId');
CREATE TRIGGER "ReferralCode_deleted_guard" BEFORE INSERT ON "ReferralCode"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('customerId');
CREATE TRIGGER "PromotionRedemption_deleted_guard" BEFORE INSERT ON "PromotionRedemption"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('customerId');
CREATE TRIGGER "Promoter_deleted_guard" BEFORE INSERT ON "Promoter"
  FOR EACH ROW EXECUTE FUNCTION flupflap_reject_deleted_owner('customerId');
