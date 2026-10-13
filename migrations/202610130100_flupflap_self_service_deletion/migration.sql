CREATE TABLE "FlupFlapDeletionRequest" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "waitReason" TEXT,
  CONSTRAINT "FlupFlapDeletionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlupFlapDeletionRequest_status_check" CHECK (status IN ('PENDING','LOCAL_DATA_DELETED')),
  CONSTRAINT "FlupFlapDeletionRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FlupFlapDeletionRequest_customerId_key" ON "FlupFlapDeletionRequest"("customerId");
CREATE INDEX "FlupFlapDeletionRequest_status_createdAt_idx" ON "FlupFlapDeletionRequest"("status", "createdAt");
ALTER TABLE "FlupFlapCustomer" DROP CONSTRAINT "FlupFlapCustomer_status_check";
ALTER TABLE "FlupFlapCustomer" ADD CONSTRAINT "FlupFlapCustomer_status_check"
  CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED','DELETION_PENDING','DELETED'));
CREATE OR REPLACE FUNCTION flupflap_reject_deleted_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT; owner_status TEXT;
BEGIN
  owner_id := to_jsonb(NEW)->>TG_ARGV[0];
  IF owner_id IS NOT NULL THEN
    SELECT status INTO owner_status FROM "FlupFlapCustomer" WHERE id = owner_id FOR UPDATE;
    IF owner_status IN ('DELETED','DELETION_PENDING') THEN RAISE EXCEPTION 'Deleted or deleting FlupFlap identity'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION flupflap_deleted_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'DELETED' AND NEW.status <> 'DELETED' THEN RAISE EXCEPTION 'Deleted identity cannot be reactivated'; END IF;
  IF OLD.status = 'DELETION_PENDING' AND NEW.status NOT IN ('DELETION_PENDING','DELETED') THEN
    RAISE EXCEPTION 'Deletion request cannot be reversed';
  END IF;
  RETURN NEW;
END $$;
-- Serialize a worker's claim with a deletion request, including stale-claim reclaim.
CREATE FUNCTION flupflap_recurring_deletion_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_status TEXT;
BEGIN
  IF NEW."claimedAt" IS NOT NULL AND NEW."claimedAt" IS DISTINCT FROM OLD."claimedAt" THEN
    SELECT status INTO owner_status FROM "FlupFlapCustomer" WHERE id = NEW."customerId" FOR UPDATE;
    IF owner_status <> 'ACTIVE' THEN RAISE EXCEPTION 'Inactive FlupFlap recurring owner'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FlupFlapRecurringRecharge_deletion_claim_guard" BEFORE UPDATE ON "FlupFlapRecurringRecharge"
  FOR EACH ROW EXECUTE FUNCTION flupflap_recurring_deletion_claim_guard();
