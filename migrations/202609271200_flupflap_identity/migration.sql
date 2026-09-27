-- Reserve the engine's domain-qualified principal namespace without reassigning history.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "User" WHERE "id" LIKE 'flupflap:%') THEN
  RAISE EXCEPTION 'Reserved FlupFlap principal namespace conflicts with a legacy User ID; review ownership before migration';
 END IF;
END $$;
-- Add a separate service identity. Existing User-owned recharge rows are unchanged.
CREATE TABLE "FlupFlapCustomer" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "email" TEXT UNIQUE,
 "passwordHash" TEXT,
 "emailVerifiedAt" TIMESTAMP(3),
 "phone" TEXT UNIQUE,
 "phoneVerifiedAt" TIMESTAMP(3),
 "status" TEXT NOT NULL DEFAULT 'ACTIVE',
 "rechargeRestricted" BOOLEAN NOT NULL DEFAULT false,
 "countryCode" TEXT,
 "guestExpiresAt" TIMESTAMP(3),
 "authVersion" INTEGER NOT NULL DEFAULT 0,
 "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
 "loginLockedUntil" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 "lastLoginAt" TIMESTAMP(3),
 CONSTRAINT "FlupFlapCustomer_status_check" CHECK ("status" IN ('ACTIVE','SUSPENDED','CLOSED')),
 CONSTRAINT "FlupFlapCustomer_credentials_check" CHECK (
  ("guestExpiresAt" IS NOT NULL AND "email" IS NULL AND "passwordHash" IS NULL) OR
  ("guestExpiresAt" IS NULL AND "email" IS NOT NULL AND "passwordHash" IS NOT NULL)),
 CONSTRAINT "FlupFlapCustomer_email_normalized" CHECK ("email" = lower(trim("email")))
);
CREATE TABLE "FlupFlapSession" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "customerId" TEXT NOT NULL REFERENCES "FlupFlapCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "authVersion" INTEGER NOT NULL DEFAULT 0,
 "refreshHash" TEXT NOT NULL UNIQUE,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FlupFlapSession_customerId_idx" ON "FlupFlapSession"("customerId");
CREATE TABLE "FlupFlapPasswordResetToken" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "customerId" TEXT NOT NULL REFERENCES "FlupFlapCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "tokenHash" TEXT NOT NULL UNIQUE,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FlupFlapPasswordResetToken_customerId_idx" ON "FlupFlapPasswordResetToken"("customerId");
ALTER TABLE "MobileTopUpRecipient" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "MobileTopUpRecipient" ADD COLUMN "flupFlapCustomerId" TEXT;
ALTER TABLE "MobileTopUpRecipient" ADD CONSTRAINT "MobileTopUpRecipient_flupFlapCustomerId_fkey" FOREIGN KEY ("flupFlapCustomerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MobileTopUpRecipient" ADD CONSTRAINT "MobileTopUpRecipient_exactly_one_owner" CHECK (("userId" IS NOT NULL) <> ("flupFlapCustomerId" IS NOT NULL));
CREATE INDEX "MobileTopUpRecipient_flupFlapCustomerId_createdAt_idx" ON "MobileTopUpRecipient"("flupFlapCustomerId", "createdAt");
ALTER TABLE "MobileTopUpQuote" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "MobileTopUpQuote" ADD COLUMN "flupFlapCustomerId" TEXT;
ALTER TABLE "MobileTopUpQuote" ADD CONSTRAINT "MobileTopUpQuote_flupFlapCustomerId_fkey" FOREIGN KEY ("flupFlapCustomerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MobileTopUpQuote" ADD CONSTRAINT "MobileTopUpQuote_exactly_one_owner" CHECK (("userId" IS NOT NULL) <> ("flupFlapCustomerId" IS NOT NULL));
CREATE INDEX "MobileTopUpQuote_flupFlapCustomerId_createdAt_idx" ON "MobileTopUpQuote"("flupFlapCustomerId", "createdAt");
ALTER TABLE "MobileTopUpTransaction" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "MobileTopUpTransaction" ADD COLUMN "flupFlapCustomerId" TEXT;
ALTER TABLE "MobileTopUpTransaction" ADD CONSTRAINT "MobileTopUpTransaction_flupFlapCustomerId_fkey" FOREIGN KEY ("flupFlapCustomerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MobileTopUpTransaction" ADD CONSTRAINT "MobileTopUpTransaction_exactly_one_owner" CHECK (("userId" IS NOT NULL) <> ("flupFlapCustomerId" IS NOT NULL));
CREATE INDEX "MobileTopUpTransaction_flupFlapCustomerId_createdAt_idx" ON "MobileTopUpTransaction"("flupFlapCustomerId", "createdAt");
CREATE UNIQUE INDEX "MobileTopUpRecipient_flupFlapCustomerId_phone_countryCode_key" ON "MobileTopUpRecipient"("flupFlapCustomerId", "phone", "countryCode");
CREATE UNIQUE INDEX "MobileTopUpTransaction_flupFlapCustomerId_idempotencyKey_key" ON "MobileTopUpTransaction"("flupFlapCustomerId", "idempotencyKey");
ALTER TABLE "AuditLog" ADD COLUMN "flupFlapCustomerId" TEXT;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_flupFlapCustomerId_fkey" FOREIGN KEY ("flupFlapCustomerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_no_mixed_actor" CHECK ("userId" IS NULL OR "flupFlapCustomerId" IS NULL);
CREATE INDEX "AuditLog_flupFlapCustomerId_createdAt_idx" ON "AuditLog"("flupFlapCustomerId", "createdAt");
