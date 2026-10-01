import { Prisma, type MobileTopUpQuote } from '@prisma/client';
import { campaignRules, MarketingError, promotionEligible, promotionPrice, promoterRewardCents } from './marketing-policy.js';

type Tx = Prisma.TransactionClient;
const minor = (value: Prisma.Decimal) => {
  const cents = value.mul(100);
  if (!cents.isInteger() || cents.isNegative() || cents.gt(Number.MAX_SAFE_INTEGER)) throw new MarketingError();
  return cents.toNumber();
};

// Called in the same transaction that inserts a NEW server-validated quote. Never
// called for quote reads/replays; historical quote/transaction amounts stay immutable.
export async function reserveQuotePromotion(tx: Tx, quote: MobileTopUpQuote, sandboxBenefits: boolean, now = new Date()) {
  if (!quote.flupFlapCustomerId || quote.userId || quote.providerCurrency !== 'USD') return quote;
  const customerId = quote.flupFlapCustomerId;
  await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
  const attribution = await tx.referralAttribution.findUnique({ where: { customerId } });
  if (!attribution?.campaignId) return quote;
  const campaignId = attribution.campaignId;
  await tx.$queryRaw`SELECT id FROM "PromotionCampaign" WHERE id = ${campaignId} FOR UPDATE`;
  const campaign = await tx.promotionCampaign.findUnique({ where: { id: campaignId }, include: { promoter: true } });
  const customer = await tx.flupFlapCustomer.findUniqueOrThrow({ where: { id: customerId } });
  if (!campaign || campaign.status !== 'ACTIVE' || campaign.startsAt > now || campaign.endsAt <= now || campaign.promoter.disabledAt ||
      campaign.testMode !== quote.testMode || campaign.promoter.customerId === customerId || customer.status !== 'ACTIVE' || customer.rechargeRestricted) return quote;
  const rules = campaignRules.parse(campaign.rules);
  // Even an accidental server flag cannot turn on live monetary promotions.
  if (!quote.testMode && (rules.benefit.type !== 'NONE' || rules.reward.type !== 'NONE')) throw new MarketingError();
  if (!sandboxBenefits && rules.benefit.type !== 'NONE') return quote;
  // Expired, unconsumed quote reservations release capacity. In-flight payments do not.
  await tx.promotionRedemption.updateMany({ where: { campaignId, status: 'RESERVED', expiresAt: { lte: now }, quote: { consumedAt: null } }, data: { status: 'EXPIRED' } });
  const capacity = { campaignId, testMode: quote.testMode, status: { in: ['RESERVED', 'FULFILLED'] as ('RESERVED' | 'FULFILLED')[] } };
  const redemptions = await tx.promotionRedemption.count({ where: capacity });
  const customerRedemptions = await tx.promotionRedemption.count({ where: { ...capacity, customerId } });
  const successfulRecharges = await tx.mobileTopUpTransaction.count({ where: {
    flupFlapCustomerId: customerId, userId: null, testMode: quote.testMode, status: 'DELIVERED', paymentStatus: 'CAPTURED',
  } });
  if (!promotionEligible(rules, { countryCode: quote.countryCode, operatorId: quote.operatorId, productId: quote.productId,
    guest: Boolean(customer.guestExpiresAt), createdAt: customer.createdAt, campaignStartsAt: campaign.startsAt,
    successfulRecharges, redemptions, customerRedemptions })) return quote;
  // Only one outstanding first-recharge reservation per customer, across campaigns.
  if (rules.firstRechargeOnly && await tx.promotionRedemption.count({ where: { customerId, testMode: quote.testMode, status: 'RESERVED',
    OR: [{ expiresAt: { gt: now } }, { quote: { consumedAt: { not: null } } }] } })) return quote;
  const price = promotionPrice(minor(quote.providerAmount), minor(quote.feeUsd), rules.benefit);
  await tx.promotionRedemption.create({ data: { quoteId: quote.id, customerId, campaignId,
    campaignVersion: campaign.version, rulesSnapshot: rules as Prisma.InputJsonValue,
    originalFeeCents: price.originalFeeCents, benefitCents: price.benefitCents,
    feeCents: price.feeCents, principalCents: price.principalCents, testMode: quote.testMode, expiresAt: quote.expiresAt } });
  return tx.mobileTopUpQuote.update({ where: { id: quote.id }, data: {
    feeUsd: new Prisma.Decimal(price.feeCents).div(100), totalChargeUsd: new Prisma.Decimal(price.totalCents).div(100),
  } });
}

// Observes persisted server state only. There are no Stripe/Reloadly calls here.
// Runs in the transaction that persists a provider/payment state transition.
export async function reconcilePromotion(tx: Tx, transactionId: string) {
  const row = await tx.mobileTopUpTransaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (!row.flupFlapCustomerId || row.userId) return;
  const redemption = await tx.promotionRedemption.findUnique({ where: { quoteId: row.quoteId } });
  const attribution = await tx.referralAttribution.findUnique({ where: { customerId: row.flupFlapCustomerId } });
  const unsafe = row.status === 'FAILED' || row.status === 'REFUNDED' || Boolean(row.failedAt || row.refundedAt || row.paymentRecoveryCode) ||
    ['REFUNDED', 'VOIDED', 'REFUND_PENDING', 'VOID_PENDING', 'FAILED'].includes(row.paymentStatus);
  if (unsafe && redemption) {
    await tx.promotionRedemption.update({ where: { id: redemption.id }, data: { status: 'REVERSED' } });
    const reward = await tx.promoterReward.findUnique({ where: { transactionId } });
    if (reward && reward.status !== 'REVERSED') {
      await tx.promoterReward.update({ where: { id: reward.id }, data: { status: 'REVERSED' } });
      await tx.promotionAuditEvent.create({ data: { rewardId: reward.id, action: 'REWARD_REVERSED',
        reason: 'Authoritative payment or fulfillment state is not eligible', snapshot: { from: reward.status, to: 'REVERSED' } } });
    }
    return;
  }
  if (unsafe || row.status !== 'DELIVERED' || row.paymentStatus !== 'CAPTURED' || !row.deliveredAt || !row.providerTransactionId ||
      !row.paymentProviderTransactionId || row.providerCurrency !== 'USD' ||
      row.paymentEnvironment !== row.rechargeEnvironment || row.testMode !== (row.paymentEnvironment === 'SANDBOX')) return;
  if (attribution) await tx.campaignEvent.upsert({ where: { visitId_type: { visitId: attribution.visitId, type: 'FIRST_SUCCESSFUL_RECHARGE' } },
    update: {}, create: { visitId: attribution.visitId, type: 'FIRST_SUCCESSFUL_RECHARGE' } });
  if (!redemption || redemption.customerId !== row.flupFlapCustomerId || redemption.testMode !== row.testMode ||
      ['REVERSED', 'EXPIRED'].includes(redemption.status)) return;
  if (minor(row.providerAmount) !== redemption.principalCents || minor(row.feeUsd) !== redemption.feeCents ||
      minor(row.totalChargeUsd) !== redemption.principalCents + redemption.feeCents) throw new MarketingError();
  const campaignId = redemption.campaignId;
  await tx.$queryRaw`SELECT id FROM "PromotionCampaign" WHERE id = ${campaignId} FOR UPDATE`;
  // Re-read after the lock. A no-reward milestone outcome is final too: a later
  // replay must not earn an old transaction a bonus from a newer campaign count.
  const current = await tx.promotionRedemption.findUniqueOrThrow({ where: { id: redemption.id } });
  if (current.status === 'FULFILLED' || current.status === 'REVERSED') return;
  // Lock + unique transaction/redemption constraints protect replay/concurrent events.
  if (await tx.promoterReward.findUnique({ where: { transactionId } })) return;
  const campaign = await tx.promotionCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: { promoter: true } });
  if (campaign.status === 'REVOKED' || campaign.promoter.disabledAt || campaign.promoter.customerId === row.flupFlapCustomerId) return;
  const rules = campaignRules.parse(redemption.rulesSnapshot);
  if (!row.testMode && rules.reward.type !== 'NONE') return;
  const fulfilled = { campaignId, testMode: row.testMode, status: 'FULFILLED' as const };
  const count = await tx.promotionRedemption.count({ where: fulfilled });
  const alreadyQualified = await tx.promotionRedemption.count({ where: { ...fulfilled, customerId: row.flupFlapCustomerId, id: { not: redemption.id } } });
  await tx.promotionRedemption.update({ where: { id: redemption.id }, data: { status: 'FULFILLED' } });
  if (rules.reward.type === 'FIXED_CUSTOMER' && alreadyQualified) return;
  const amountCents = promoterRewardCents(redemption.feeCents, rules.reward, count + (redemption.status === 'FULFILLED' ? 0 : 1));
  if (!amountCents) return;
  const reward = await tx.promoterReward.create({ data: { redemptionId: redemption.id, transactionId, amountCents, testMode: row.testMode } });
  await tx.promotionAuditEvent.create({ data: { rewardId: reward.id, action: 'REWARD_PENDING',
    reason: 'Verified captured payment and delivered recharge', snapshot: { amountCents, testMode: row.testMode } } });
}
