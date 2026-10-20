CREATE TABLE "FlupFlapAppDownloadDaily" (
 "platform" TEXT NOT NULL CHECK ("platform" IN ('ANDROID','IOS')),
 "appId" TEXT NOT NULL,
 "reportDate" DATE NOT NULL,
 "downloads" INTEGER NOT NULL CHECK ("downloads" >= 0),
 "reportHash" TEXT NOT NULL,
 "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("platform", "appId", "reportDate")
);
