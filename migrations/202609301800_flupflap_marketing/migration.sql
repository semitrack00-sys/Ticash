-- CreateEnum
CREATE TYPE "PromotionCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'DISABLED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PromoterRewardStatus" AS ENUM ('PENDING', 'APPROVED', 'PAYABLE', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "CampaignEventType" AS ENUM ('LANDING_VIEWED', 'SIGNUP_STARTED', 'ACCOUNT_CREATED', 'FIRST_SUCCESSFUL_RECHARGE');

-- CreateEnum
CREATE TYPE "PromotionRedemptionStatus" AS ENUM ('RESERVED', 'FULFILLED', 'EXPIRED', 'REVERSED');

-- CreateTable
CREATE TABLE "ReferralCode" (
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Promoter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionCampaign" (
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "promoterId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PromotionCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "rules" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignVisit" (
    "id" TEXT NOT NULL,
    "capabilityHash" TEXT NOT NULL,
    "referralCode" TEXT,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralAttribution" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "referralCode" TEXT,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "type" "CampaignEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "PromotionRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "campaignVersion" INTEGER NOT NULL,
    "rulesSnapshot" JSONB NOT NULL,
    "originalFeeCents" INTEGER NOT NULL,
    "benefitCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "principalCents" INTEGER NOT NULL,
    "testMode" BOOLEAN NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoterReward" (
    "id" TEXT NOT NULL,
    "redemptionId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PromoterRewardStatus" NOT NULL DEFAULT 'PENDING',
    "testMode" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoterReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionAuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "campaignId" TEXT,
    "rewardId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_customerId_key" ON "ReferralCode"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Promoter_customerId_key" ON "Promoter"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionCampaign_code_key" ON "PromotionCampaign"("code");

-- CreateIndex
CREATE INDEX "PromotionCampaign_promoterId_status_idx" ON "PromotionCampaign"("promoterId", "status");

-- CreateIndex
CREATE INDEX "PromotionCampaign_status_startsAt_endsAt_idx" ON "PromotionCampaign"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVisit_capabilityHash_key" ON "CampaignVisit"("capabilityHash");

-- CreateIndex
CREATE INDEX "CampaignVisit_campaignId_createdAt_idx" ON "CampaignVisit"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignVisit_expiresAt_idx" ON "CampaignVisit"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralAttribution_customerId_key" ON "ReferralAttribution"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralAttribution_visitId_key" ON "ReferralAttribution"("visitId");

-- CreateIndex
CREATE INDEX "ReferralAttribution_campaignId_createdAt_idx" ON "ReferralAttribution"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralAttribution_referralCode_createdAt_idx" ON "ReferralAttribution"("referralCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEvent_visitId_type_key" ON "CampaignEvent"("visitId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRedemption_quoteId_key" ON "PromotionRedemption"("quoteId");

-- CreateIndex
CREATE INDEX "PromotionRedemption_campaignId_status_testMode_idx" ON "PromotionRedemption"("campaignId", "status", "testMode");

-- CreateIndex
CREATE INDEX "PromotionRedemption_customerId_campaignId_testMode_idx" ON "PromotionRedemption"("customerId", "campaignId", "testMode");

-- CreateIndex
CREATE UNIQUE INDEX "PromoterReward_redemptionId_key" ON "PromoterReward"("redemptionId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoterReward_transactionId_key" ON "PromoterReward"("transactionId");

-- CreateIndex
CREATE INDEX "PromoterReward_status_testMode_idx" ON "PromoterReward"("status", "testMode");

-- CreateIndex
CREATE INDEX "PromotionAuditEvent_campaignId_createdAt_idx" ON "PromotionAuditEvent"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionAuditEvent_rewardId_createdAt_idx" ON "PromotionAuditEvent"("rewardId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promoter" ADD CONSTRAINT "Promoter_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVisit" ADD CONSTRAINT "CampaignVisit_referralCode_fkey" FOREIGN KEY ("referralCode") REFERENCES "ReferralCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVisit" ADD CONSTRAINT "CampaignVisit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "CampaignVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_referralCode_fkey" FOREIGN KEY ("referralCode") REFERENCES "ReferralCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "CampaignVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "MobileTopUpQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "FlupFlapCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoterReward" ADD CONSTRAINT "PromoterReward_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "PromotionRedemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoterReward" ADD CONSTRAINT "PromoterReward_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "MobileTopUpTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionAuditEvent" ADD CONSTRAINT "PromotionAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionAuditEvent" ADD CONSTRAINT "PromotionAuditEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionAuditEvent" ADD CONSTRAINT "PromotionAuditEvent_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "PromoterReward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defence in depth for public identifiers, financial invariants and append-only audit.
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_opaque" CHECK (code ~ '^[a-f0-9]{32}$');
ALTER TABLE "PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_code_shape" CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{5,31}$');
ALTER TABLE "PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_valid_dates" CHECK ("endsAt" > "startsAt");
ALTER TABLE "PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_no_live_money" CHECK (
  "testMode" OR COALESCE(rules->'benefit'->>'type' = 'NONE' AND rules->'reward'->>'type' = 'NONE', false));
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_balanced" CHECK (
  "principalCents" > 0 AND "originalFeeCents" >= 0 AND "benefitCents" >= 0 AND "feeCents" >= 0
  AND "originalFeeCents" = "benefitCents" + "feeCents"
  AND ("testMode" OR "benefitCents" = 0));
ALTER TABLE "PromoterReward" ADD CONSTRAINT "PromoterReward_nonnegative" CHECK ("amountCents" >= 0);
ALTER TABLE "PromoterReward" ADD CONSTRAINT "PromoterReward_test_not_paid" CHECK (NOT "testMode" OR status <> 'PAID');
CREATE FUNCTION "rejectPromotionAuditMutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Promotion audit records are append-only'; END;
$$;
CREATE TRIGGER "PromotionAuditEvent_append_only" BEFORE UPDATE OR DELETE ON "PromotionAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "rejectPromotionAuditMutation"();
