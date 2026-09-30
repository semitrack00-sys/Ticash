-- Persist only a provider-validated destination catalog so Render restarts do not
-- erase browsing availability during a temporary provider outage.
CREATE TABLE "MobileTopUpCountryCatalogCache" (
    "key" TEXT NOT NULL,
    "countries" JSONB NOT NULL,
    "validatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileTopUpCountryCatalogCache_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "MobileTopUpCountryCatalogCache_expiresAt_idx" ON "MobileTopUpCountryCatalogCache"("expiresAt");
