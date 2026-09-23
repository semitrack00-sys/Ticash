-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AdminConfigType" AS ENUM ('FEES_AND_LIMITS');

-- CreateEnum
CREATE TYPE "public"."ComplianceStatus" AS ENUM ('CLEAR', 'REVIEW', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."FundingProviderName" AS ENUM ('DWOLLA');

-- CreateEnum
CREATE TYPE "public"."FundingSourceStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REMOVED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."FundingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED', 'REVIEW_REQUIRED', 'IN_REVIEW', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "public"."LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "public"."MobileTopUpKind" AS ENUM ('AIRTIME', 'DATA');

-- CreateEnum
CREATE TYPE "public"."MobileTopUpPaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."MobileTopUpProviderName" AS ENUM ('RELOADLY', 'DING');

-- CreateEnum
CREATE TYPE "public"."MobileTopUpStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "public"."NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PayoutOperationalState" AS ENUM ('DISABLED', 'SANDBOX', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."Provider" AS ENUM ('MONCASH', 'NATCASH', 'HAITIAN_BANK');

-- CreateEnum
CREATE TYPE "public"."ReconciliationStatus" AS ENUM ('PASS', 'DISCREPANCIES_FOUND', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."TransferStage" AS ENUM ('AWAITING_FUNDING', 'FUNDING_PROCESSING', 'COMPLIANCE_REVIEW', 'PAYOUT_PROCESSING', 'DELIVERED', 'FAILED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."TransferStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('CUSTOMER', 'ADMIN', 'SUPER_ADMIN', 'COMPLIANCE', 'OPERATIONS', 'SUPPORT', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "public"."WebhookProcessingStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."AdminConfigVersion" (
    "id" TEXT NOT NULL,
    "type" "public"."AdminConfigType" NOT NULL,
    "version" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ComplianceDecision" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "status" "public"."ComplianceStatus" NOT NULL,
    "reasons" JSONB NOT NULL,
    "screeningProvider" TEXT,
    "screeningReferenceId" TEXT,
    "screeningPerformed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CorridorConfig" (
    "id" TEXT NOT NULL,
    "sendCountry" TEXT NOT NULL,
    "sourceCurrency" TEXT NOT NULL,
    "receiveCountry" TEXT NOT NULL DEFAULT 'HT',
    "targetCurrency" TEXT NOT NULL DEFAULT 'HTG',
    "fundingProvider" "public"."FundingProviderName" NOT NULL,
    "payoutMethod" "public"."Provider" NOT NULL,
    "enabledForSandbox" BOOLEAN NOT NULL DEFAULT false,
    "approvedForLiveUse" BOOLEAN NOT NULL DEFAULT false,
    "fundingProviderApproved" BOOLEAN NOT NULL DEFAULT false,
    "payoutProviderApproved" BOOLEAN NOT NULL DEFAULT false,
    "regulatoryApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorridorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FundingProviderCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."FundingProviderName" NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "providerCustomerUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingProviderCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FundingSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."FundingProviderName" NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "providerFundingSourceId" TEXT NOT NULL,
    "providerFundingSourceUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastFour" TEXT NOT NULL,
    "bankAccountType" TEXT NOT NULL,
    "status" "public"."FundingSourceStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "bankName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "microDepositsInitiatedAt" TIMESTAMP(3),
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "verificationFailureCode" TEXT,

    CONSTRAINT "FundingSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FundingTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fundingSourceId" TEXT NOT NULL,
    "provider" "public"."FundingProviderName" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "public"."FundingStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "providerTransferId" TEXT,
    "providerTransferUrl" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "transferId" TEXT,

    CONSTRAINT "FundingTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FxQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "sendCountry" TEXT NOT NULL,
    "receiveCountry" TEXT NOT NULL,
    "sourceCurrency" TEXT NOT NULL,
    "targetCurrency" TEXT NOT NULL,
    "payoutMethod" TEXT NOT NULL,
    "sendAmount" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,6) NOT NULL,
    "ticashFee" DECIMAL(18,2) NOT NULL,
    "providerFee" DECIMAL(18,2) NOT NULL,
    "totalCustomerCharge" DECIMAL(18,2) NOT NULL,
    "recipientAmount" DECIMAL(18,2) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "configurationVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IdempotencyKey" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."KycProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "level" INTEGER NOT NULL DEFAULT 0,
    "documentRef" TEXT,
    "selfieRef" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "diditSessionId" TEXT,
    "diditStatusUpdatedAt" TIMESTAMP(3),
    "kycFailureReason" TEXT,
    "kycStartedAt" TIMESTAMP(3),
    "kycVerifiedAt" TIMESTAMP(3),

    CONSTRAINT "KycProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."KycWebhookEvent" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "webhookType" TEXT NOT NULL,
    "diditSessionId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "status" "public"."WebhookProcessingStatus" NOT NULL DEFAULT 'PROCESSING',
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReceivedAt" TIMESTAMP(3),
    "duplicateDeliveryCount" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "KycWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LedgerAccount" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."LedgerAccountType" NOT NULL,
    "currency" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "public"."LedgerDirection" NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LedgerTransaction" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fundingTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoginSecurityState" (
    "id" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginSecurityState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MobileTopUpQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."MobileTopUpProviderName" NOT NULL DEFAULT 'RELOADLY',
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "countryCode" TEXT NOT NULL DEFAULT 'HT',
    "recipientPhone" TEXT NOT NULL,
    "operatorId" INTEGER NOT NULL,
    "operatorName" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "kind" "public"."MobileTopUpKind" NOT NULL,
    "providerAmount" DECIMAL(18,2) NOT NULL,
    "providerCurrency" TEXT NOT NULL,
    "deliveredValue" DECIMAL(18,2),
    "deliveredCurrency" TEXT NOT NULL,
    "feeUsd" DECIMAL(18,2) NOT NULL,
    "totalChargeUsd" DECIMAL(18,2) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileTopUpQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MobileTopUpRecipient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'HT',
    "operatorId" INTEGER,
    "operatorName" TEXT,
    "lastProductId" TEXT,
    "lastProductName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileTopUpRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MobileTopUpTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientId" TEXT,
    "quoteId" TEXT NOT NULL,
    "provider" "public"."MobileTopUpProviderName" NOT NULL DEFAULT 'RELOADLY',
    "providerTransactionId" TEXT,
    "operatorTransactionId" TEXT,
    "customIdentifier" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "public"."MobileTopUpStatus" NOT NULL DEFAULT 'PENDING',
    "paymentStatus" "public"."MobileTopUpPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentAuthorizationId" TEXT,
    "recipientPhone" TEXT NOT NULL,
    "operatorId" INTEGER NOT NULL,
    "operatorName" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "kind" "public"."MobileTopUpKind" NOT NULL,
    "providerAmount" DECIMAL(18,2) NOT NULL,
    "providerCurrency" TEXT NOT NULL,
    "deliveredValue" DECIMAL(18,2),
    "deliveredCurrency" TEXT NOT NULL,
    "feeUsd" DECIMAL(18,2) NOT NULL,
    "totalChargeUsd" DECIMAL(18,2) NOT NULL,
    "providerStatus" TEXT,
    "failureCode" TEXT,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "MobileTopUpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "type" TEXT NOT NULL,
    "status" "public"."NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PayoutMethodConfig" (
    "id" TEXT NOT NULL,
    "method" "public"."Provider" NOT NULL,
    "state" "public"."PayoutOperationalState" NOT NULL DEFAULT 'DISABLED',
    "environment" TEXT NOT NULL DEFAULT 'MOCK',
    "providerConfigured" BOOLEAN NOT NULL DEFAULT false,
    "providerApproved" BOOLEAN NOT NULL DEFAULT false,
    "regulatoryApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedForLiveUse" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "statusMessage" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutMethodConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProviderWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "public"."FundingProviderName" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "public"."WebhookProcessingStatus" NOT NULL DEFAULT 'PROCESSING',
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "duplicateDeliveryCount" INTEGER NOT NULL DEFAULT 0,
    "lastReceivedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Recipient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "provider" "public"."Provider" NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "middleName" TEXT,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationDiscrepancy" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "expected" TEXT,
    "actual" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "public"."ReconciliationStatus" NOT NULL,
    "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "summary" JSONB,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Transfer" (
    "id" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "provider" "public"."Provider" NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "feeUsd" DECIMAL(18,2) NOT NULL,
    "exchangeRate" DECIMAL(18,4) NOT NULL,
    "amountHtg" DECIMAL(18,2) NOT NULL,
    "status" "public"."TransferStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "complianceReviewedAt" TIMESTAMP(3),
    "complianceStatus" "public"."ComplianceStatus" NOT NULL DEFAULT 'REVIEW',
    "configurationVersionId" TEXT,
    "immutableAt" TIMESTAMP(3),
    "payoutDestinationSnapshot" TEXT,
    "payoutStartedAt" TIMESTAMP(3),
    "providerFeeUsd" DECIMAL(18,2),
    "quoteId" TEXT,
    "recipientNameSnapshot" TEXT,
    "recipientPhoneSnapshot" TEXT,
    "referenceNumber" TEXT,
    "riskFlags" JSONB,
    "stage" "public"."TransferStage" NOT NULL DEFAULT 'AWAITING_FUNDING',
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "ticashFeeUsd" DECIMAL(18,2),
    "totalChargeUsd" DECIMAL(18,2),

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "kycStatus" "public"."KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "role" "public"."UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountLocked" BOOLEAN NOT NULL DEFAULT false,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "countryCode" TEXT,
    "fundingRestricted" BOOLEAN NOT NULL DEFAULT false,
    "payoutRestricted" BOOLEAN NOT NULL DEFAULT false,
    "postalCode" TEXT,
    "region" TEXT,
    "restrictedAt" TIMESTAMP(3),
    "restrictionReason" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminConfigVersion_type_effectiveAt_retiredAt_idx" ON "public"."AdminConfigVersion"("type" ASC, "effectiveAt" ASC, "retiredAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AdminConfigVersion_type_version_key" ON "public"."AdminConfigVersion"("type" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "public"."AuditLog"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "ComplianceDecision_subjectUserId_createdAt_idx" ON "public"."ComplianceDecision"("subjectUserId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "ComplianceDecision_transferId_createdAt_idx" ON "public"."ComplianceDecision"("transferId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "CorridorConfig_receiveCountry_approvedForLiveUse_idx" ON "public"."CorridorConfig"("receiveCountry" ASC, "approvedForLiveUse" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CorridorConfig_sendCountry_sourceCurrency_receiveCountry_ta_key" ON "public"."CorridorConfig"("sendCountry" ASC, "sourceCurrency" ASC, "receiveCountry" ASC, "targetCurrency" ASC, "fundingProvider" ASC, "payoutMethod" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FundingProviderCustomer_provider_providerCustomerId_key" ON "public"."FundingProviderCustomer"("provider" ASC, "providerCustomerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FundingProviderCustomer_userId_provider_key" ON "public"."FundingProviderCustomer"("userId" ASC, "provider" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FundingSource_provider_providerFundingSourceId_key" ON "public"."FundingSource"("provider" ASC, "providerFundingSourceId" ASC);

-- CreateIndex
CREATE INDEX "FundingSource_userId_provider_status_idx" ON "public"."FundingSource"("userId" ASC, "provider" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FundingTransaction_provider_providerTransferId_key" ON "public"."FundingTransaction"("provider" ASC, "providerTransferId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FundingTransaction_transferId_key" ON "public"."FundingTransaction"("transferId" ASC);

-- CreateIndex
CREATE INDEX "FundingTransaction_userId_createdAt_idx" ON "public"."FundingTransaction"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FundingTransaction_userId_idempotencyKey_key" ON "public"."FundingTransaction"("userId" ASC, "idempotencyKey" ASC);

-- CreateIndex
CREATE INDEX "FxQuote_expiresAt_consumedAt_idx" ON "public"."FxQuote"("expiresAt" ASC, "consumedAt" ASC);

-- CreateIndex
CREATE INDEX "FxQuote_sendCountry_receiveCountry_sourceCurrency_targetCur_idx" ON "public"."FxQuote"("sendCountry" ASC, "receiveCountry" ASC, "sourceCurrency" ASC, "targetCurrency" ASC);

-- CreateIndex
CREATE INDEX "FxQuote_userId_createdAt_idx" ON "public"."FxQuote"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_diditSessionId_key" ON "public"."KycProfile"("diditSessionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_userId_key" ON "public"."KycProfile"("userId" ASC);

-- CreateIndex
CREATE INDEX "KycWebhookEvent_diditSessionId_receivedAt_idx" ON "public"."KycWebhookEvent"("diditSessionId" ASC, "receivedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "KycWebhookEvent_providerEventId_key" ON "public"."KycWebhookEvent"("providerEventId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_key_key" ON "public"."LedgerAccount"("key" ASC);

-- CreateIndex
CREATE INDEX "LedgerAccount_userId_currency_idx" ON "public"."LedgerAccount"("userId" ASC, "currency" ASC);

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "public"."LedgerEntry"("accountId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "LedgerEntry_transactionId_idx" ON "public"."LedgerEntry"("transactionId" ASC);

-- CreateIndex
CREATE INDEX "LedgerTransaction_fundingTransactionId_idx" ON "public"."LedgerTransaction"("fundingTransactionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reference_key" ON "public"."LedgerTransaction"("reference" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LoginSecurityState_identityHash_key" ON "public"."LoginSecurityState"("identityHash" ASC);

-- CreateIndex
CREATE INDEX "MobileTopUpQuote_expiresAt_consumedAt_idx" ON "public"."MobileTopUpQuote"("expiresAt" ASC, "consumedAt" ASC);

-- CreateIndex
CREATE INDEX "MobileTopUpQuote_userId_createdAt_idx" ON "public"."MobileTopUpQuote"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MobileTopUpRecipient_userId_phone_key" ON "public"."MobileTopUpRecipient"("userId" ASC, "phone" ASC);

-- CreateIndex
CREATE INDEX "MobileTopUpRecipient_userId_updatedAt_idx" ON "public"."MobileTopUpRecipient"("userId" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MobileTopUpTransaction_customIdentifier_key" ON "public"."MobileTopUpTransaction"("customIdentifier" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MobileTopUpTransaction_provider_providerTransactionId_key" ON "public"."MobileTopUpTransaction"("provider" ASC, "providerTransactionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MobileTopUpTransaction_quoteId_key" ON "public"."MobileTopUpTransaction"("quoteId" ASC);

-- CreateIndex
CREATE INDEX "MobileTopUpTransaction_status_updatedAt_idx" ON "public"."MobileTopUpTransaction"("status" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE INDEX "MobileTopUpTransaction_userId_createdAt_idx" ON "public"."MobileTopUpTransaction"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MobileTopUpTransaction_userId_idempotencyKey_key" ON "public"."MobileTopUpTransaction"("userId" ASC, "idempotencyKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutMethodConfig_method_key" ON "public"."PayoutMethodConfig"("method" ASC);

-- CreateIndex
CREATE INDEX "PayoutMethodConfig_state_environment_idx" ON "public"."PayoutMethodConfig"("state" ASC, "environment" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderWebhookEvent_provider_providerEventId_key" ON "public"."ProviderWebhookEvent"("provider" ASC, "providerEventId" ASC);

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_provider_receivedAt_idx" ON "public"."ProviderWebhookEvent"("provider" ASC, "receivedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_userId_phone_provider_key" ON "public"."Recipient"("userId" ASC, "phone" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "ReconciliationDiscrepancy_runId_code_idx" ON "public"."ReconciliationDiscrepancy"("runId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "ReconciliationRun_provider_startedAt_idx" ON "public"."ReconciliationRun"("provider" ASC, "startedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshHash_key" ON "public"."Session"("refreshHash" ASC);

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_idempotencyKey_key" ON "public"."Transfer"("idempotencyKey" ASC);

-- CreateIndex
CREATE INDEX "Transfer_provider_providerTransactionId_idx" ON "public"."Transfer"("provider" ASC, "providerTransactionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_quoteId_key" ON "public"."Transfer"("quoteId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_referenceNumber_key" ON "public"."Transfer"("referenceNumber" ASC);

-- CreateIndex
CREATE INDEX "Transfer_senderUserId_createdAt_idx" ON "public"."Transfer"("senderUserId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "public"."User"("phone" ASC);

-- AddForeignKey
ALTER TABLE "public"."AdminConfigVersion" ADD CONSTRAINT "AdminConfigVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ComplianceDecision" ADD CONSTRAINT "ComplianceDecision_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ComplianceDecision" ADD CONSTRAINT "ComplianceDecision_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ComplianceDecision" ADD CONSTRAINT "ComplianceDecision_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "public"."Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FundingProviderCustomer" ADD CONSTRAINT "FundingProviderCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FundingSource" ADD CONSTRAINT "FundingSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FundingTransaction" ADD CONSTRAINT "FundingTransaction_fundingSourceId_fkey" FOREIGN KEY ("fundingSourceId") REFERENCES "public"."FundingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FundingTransaction" ADD CONSTRAINT "FundingTransaction_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "public"."Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FundingTransaction" ADD CONSTRAINT "FundingTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FxQuote" ADD CONSTRAINT "FxQuote_configurationVersionId_fkey" FOREIGN KEY ("configurationVersionId") REFERENCES "public"."AdminConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FxQuote" ADD CONSTRAINT "FxQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KycProfile" ADD CONSTRAINT "KycProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerAccount" ADD CONSTRAINT "LedgerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_fundingTransactionId_fkey" FOREIGN KEY ("fundingTransactionId") REFERENCES "public"."FundingTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MobileTopUpQuote" ADD CONSTRAINT "MobileTopUpQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MobileTopUpRecipient" ADD CONSTRAINT "MobileTopUpRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MobileTopUpTransaction" ADD CONSTRAINT "MobileTopUpTransaction_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "public"."MobileTopUpQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MobileTopUpTransaction" ADD CONSTRAINT "MobileTopUpTransaction_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."MobileTopUpRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MobileTopUpTransaction" ADD CONSTRAINT "MobileTopUpTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayoutMethodConfig" ADD CONSTRAINT "PayoutMethodConfig_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Recipient" ADD CONSTRAINT "Recipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationDiscrepancy" ADD CONSTRAINT "ReconciliationDiscrepancy_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."ReconciliationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transfer" ADD CONSTRAINT "Transfer_configurationVersionId_fkey" FOREIGN KEY ("configurationVersionId") REFERENCES "public"."AdminConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transfer" ADD CONSTRAINT "Transfer_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "public"."FxQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transfer" ADD CONSTRAINT "Transfer_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."Recipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transfer" ADD CONSTRAINT "Transfer_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
