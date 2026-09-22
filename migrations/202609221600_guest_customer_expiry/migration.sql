-- Normal accounts retain NULL. Guest identities expire without deleting test receipts.
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "guestExpiresAt" TIMESTAMP(3);
