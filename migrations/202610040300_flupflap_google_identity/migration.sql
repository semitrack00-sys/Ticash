ALTER TABLE "FlupFlapCustomer" ADD COLUMN "googleSubject" TEXT;
CREATE UNIQUE INDEX "FlupFlapCustomer_googleSubject_key" ON "FlupFlapCustomer"("googleSubject");
