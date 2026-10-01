ALTER TABLE "FlupFlapCustomer"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT;

-- Existing accounts remain valid. New permanent-account registration requires
-- first name, last name, and phone at the API boundary.
