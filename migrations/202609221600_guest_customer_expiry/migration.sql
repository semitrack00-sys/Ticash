-- Normal accounts retain NULL. Guest identities expire without deleting test receipts.
ALTER TABLE "User" ADD COLUMN "guestExpiresAt" TIMESTAMP(3);
