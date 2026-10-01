import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { campaignInput, campaignRules, MarketingError, newPromotionCode, newReferralCode,
  promotionCode, referralCode, shareLink, rewardTransition } from './marketing-policy.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const visitInput = z.object({ r: referralCode.optional(), promo: promotionCode.optional() }).strict();
export const visitCapability = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const marketingEnabled = () => process.env.FLUPFLAP_MARKETING_ENABLED === 'true';
export const sandboxBenefitsEnabled = () => process.env.FLUPFLAP_MARKETING_SANDBOX_BENEFITS === 'true';
const activeCampaign = (c: {status: string; startsAt: Date; endsAt: Date; promoter: {disabledAt: Date | null}} | null, now: Date) =>
  c && c.status === 'ACTIVE' && c.startsAt <= now && c.endsAt > now && !c.promoter.disabledAt;

export class FlupFlapMarketing {
  constructor(readonly db: PrismaClient, readonly clock = () => new Date()) {}

  async quotePresentation(quoteId: string, customerId: string) {
    const p = await this.db.promotionRedemption.findFirst({ where: { quoteId, customerId }, include: { campaign: { select: { name: true } } } });
    return p ? { promotion: { name: p.campaign.name, originalFeeCents: p.originalFeeCents, benefitCents: p.benefitCents,
      firstRechargeOnly: campaignRules.parse(p.rulesSnapshot).firstRechargeOnly, testMode: p.testMode } } : {};
  }

  async referral(customerId: string) {
    const customer = await this.db.flupFlapCustomer.findUnique({ where: { id: customerId } });
    if (!customer || customer.guestExpiresAt || customer.status !== 'ACTIVE' || customer.rechargeRestricted) throw new MarketingError();
    const record = await this.db.referralCode.upsert({ where: { customerId }, update: {},
      create: { customerId, code: newReferralCode() } });
    if (record.disabledAt) throw new MarketingError();
    return { url: shareLink(record.code), code: record.code };
  }

  async visit(input: z.infer<typeof visitInput>, previous?: string) {
    const now = this.clock();
    const campaign = input.promo ? await this.db.promotionCampaign.findUnique({ where: { code: input.promo }, include: { promoter: true } }) : null;
    const referral = input.r ? await this.db.referralCode.findUnique({ where: { code: input.r }, include: { customer: true } }) : null;
    // No detailed enumeration oracle (paused/unknown/exhausted all use one error).
    if (input.promo && !activeCampaign(campaign, now)) throw new MarketingError();
    if (input.r && (!referral || referral.disabledAt || referral.customer.status !== 'ACTIVE' || referral.customer.rechargeRestricted)) throw new MarketingError();
    const rules = campaign ? campaignRules.parse(campaign.rules) : null;
    if (campaign && await this.db.promotionRedemption.count({ where: { campaignId: campaign.id, status: { in: ['RESERVED', 'FULFILLED'] }, OR: [{ status: 'FULFILLED' }, { expiresAt: { gt: now } }, { quote: { consumedAt: { not: null } } }] } }) >= rules!.maxRedemptions) throw new MarketingError();
    // Explicit promo wins; optional referral co-attribution never creates a second reward.
    const ref = campaign && !rules!.allowReferralAttribution ? null : referral;
    const prior = previous && visitCapability.safeParse(previous).success ? await this.db.campaignVisit.findUnique({ where: { capabilityHash: hash(previous) } }) : null;
    const reusable = prior && prior.expiresAt > now && prior.campaignId === (campaign?.id ?? null) && prior.referralCode === (ref?.code ?? null);
    const capability = reusable ? previous! : randomBytes(32).toString('base64url');
    const record = reusable ? prior : await this.db.campaignVisit.create({ data: {
      capabilityHash: hash(capability), referralCode: ref?.code, campaignId: campaign?.id,
      expiresAt: new Date(now.getTime() + 24 * 3600000),
      events: { create: { type: 'LANDING_VIEWED' } },
    } });
    return { capability, expiresAt: record.expiresAt.toISOString(), promotion: campaign ? {
      name: campaign.name, code: campaign.code, testMode: campaign.testMode,
      benefitsEnabled: campaign.testMode && sandboxBenefitsEnabled(),
      benefit: rules!.benefit, firstRechargeOnly: rules!.firstRechargeOnly,
    } : null };
  }

  async signupStarted(capability: string) {
    const visit = await this.db.campaignVisit.findUnique({ where: { capabilityHash: hash(capability) } });
    if (!visit || visit.expiresAt <= this.clock()) throw new MarketingError();
    await this.db.campaignEvent.upsert({ where: { visitId_type: { visitId: visit.id, type: 'SIGNUP_STARTED' } }, update: {},
      create: { visitId: visit.id, type: 'SIGNUP_STARTED' } });
  }

  async claim(customerId: string, capability: string) {
    return this.db.$transaction(async tx => {
      // Customer lock makes attribution immutable even under concurrent claim attempts.
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
      const customer = await tx.flupFlapCustomer.findUnique({ where: { id: customerId } });
      if (!customer || customer.status !== 'ACTIVE' || customer.rechargeRestricted) throw new MarketingError();
      const existing = await tx.referralAttribution.findUnique({ where: { customerId } });
      const visit = await tx.campaignVisit.findUnique({ where: { capabilityHash: hash(capability) }, include: {
        referral: true, campaign: { include: { promoter: true } }, attribution: true,
      } });
      if (existing) {
        if (visit?.id === existing.visitId) return { attributed: true };
        throw new MarketingError('ATTRIBUTION_ALREADY_SET');
      }
      if (!visit || visit.expiresAt <= this.clock() || visit.attribution) throw new MarketingError();
      if (visit.referral?.customerId === customerId || visit.campaign?.promoter.customerId === customerId) throw new MarketingError();
      if (visit.campaign && !activeCampaign(visit.campaign, this.clock())) throw new MarketingError();
      if (visit.referral?.disabledAt) throw new MarketingError();
      const rules = visit.campaign ? campaignRules.parse(visit.campaign.rules) : null;
      // Referrals acquire new registered customers; existing account login cannot claim a new referral.
      if (visit.referral && (customer.guestExpiresAt || customer.createdAt < visit.createdAt)) throw new MarketingError();
      if (rules && ((!rules.customerTypes.includes(customer.guestExpiresAt ? 'GUEST' : 'REGISTERED')) ||
          (rules.newCustomerOnly && customer.createdAt < visit.createdAt))) throw new MarketingError();
      await tx.referralAttribution.create({ data: { customerId, visitId: visit.id, referralCode: visit.referralCode, campaignId: visit.campaignId } });
      if (!customer.guestExpiresAt && customer.createdAt >= visit.createdAt) await tx.campaignEvent.upsert({
        where: { visitId_type: { visitId: visit.id, type: 'ACCOUNT_CREATED' } }, update: {}, create: { visitId: visit.id, type: 'ACCOUNT_CREATED' },
      });
      return { attributed: true };
    });
  }

  async createPromoter(actorId: string, input: { name: string; customerId?: string }) {
    return this.db.$transaction(async tx => {
      if (input.customerId) {
        const c = await tx.flupFlapCustomer.findUnique({ where: { id: input.customerId } });
        if (!c || c.guestExpiresAt || c.status !== 'ACTIVE') throw new MarketingError();
      }
      const promoter = await tx.promoter.create({ data: input });
      await tx.promotionAuditEvent.create({ data: { actorId, action: 'PROMOTER_CREATED', reason: 'Administrator created promoter', snapshot: { promoterId: promoter.id } } });
      return { id: promoter.id, name: promoter.name };
    });
  }

  async saveCampaign(actorId: string, input: z.infer<typeof campaignInput>, id?: string) {
    return this.db.$transaction(async tx => {
      const old = id ? await tx.promotionCampaign.findUnique({ where: { id } }) : null;
      if (id && !old) throw new MarketingError();
      if (old?.status === 'REVOKED') throw new MarketingError();
      if (old && (input.code && input.code !== old.code || input.promoterId !== old.promoterId || input.testMode !== old.testMode)) throw new MarketingError();
      const { reason, ...values } = input;
      const data = { ...values, code: old?.code ?? input.code ?? newPromotionCode(), rules: input.rules as Prisma.InputJsonValue,
        startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) };
      const row = old ? await tx.promotionCampaign.update({ where: { id: old.id, version: old.version }, data: { ...data, version: { increment: 1 } } })
        : await tx.promotionCampaign.create({ data });
      await tx.promotionAuditEvent.create({ data: { actorId, campaignId: row.id, action: old ? 'CAMPAIGN_UPDATED' : 'CAMPAIGN_CREATED', reason,
        snapshot: JSON.parse(JSON.stringify({ before: old, after: row })) as Prisma.InputJsonValue } });
      return row;
    });
  }

  async changeReward(actorId: string, id: string, to: 'APPROVED' | 'PAYABLE' | 'PAID' | 'REVERSED', reason: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PromoterReward" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.promoterReward.findUnique({ where: { id }, include: { transaction: true } });
      if (!row) throw new MarketingError();
      rewardTransition(row.status, to, reason);
      // Test ledger cannot be marked as real cash paid. No payout execution exists here.
      if (row.testMode && to === 'PAID') throw new MarketingError('TEST_REWARD_NOT_PAYABLE');
      if (to !== 'REVERSED' && (row.transaction.status !== 'DELIVERED' || row.transaction.paymentStatus !== 'CAPTURED' ||
          row.transaction.refundedAt || row.transaction.failedAt || row.transaction.paymentRecoveryCode)) throw new MarketingError();
      await tx.promoterReward.update({ where: { id, status: row.status }, data: { status: to } });
      await tx.promotionAuditEvent.create({ data: { actorId, rewardId: id, action: 'REWARD_STATUS_CHANGED', reason, snapshot: { from: row.status, to } } });
    });
  }

  // Explicit aggregate projection; future promoter routes must derive promoterId from
  // an authenticated identity, never a browser-selected ID. No customer records returned.
  async report(promoterId?: string) {
    const campaigns = await this.db.promotionCampaign.findMany({ where: promoterId ? { promoterId } : {}, orderBy: { createdAt: 'desc' }, take: 100 });
    return Promise.all(campaigns.map(async c => {
      const events = await this.db.campaignEvent.groupBy({ by: ['type'], where: { visit: { campaignId: c.id } }, _count: true });
      const redeemed = await this.db.promotionRedemption.aggregate({ where: { campaignId: c.id, status: 'FULFILLED' }, _count: true, _sum: { benefitCents: true, feeCents: true } });
      const rewards = await this.db.promoterReward.groupBy({ by: ['status'], where: { redemption: { campaignId: c.id } }, _count: true, _sum: { amountCents: true } });
      const funnel = Object.fromEntries(events.map(e => [e.type, e._count]));
      const qualifiedCustomers = await this.db.promotionRedemption.groupBy({ by: ['customerId'], where: { campaignId: c.id, status: 'FULFILLED' } });
      return { id: c.id, name: c.name, code: c.code, status: c.endsAt <= this.clock() && c.status === 'ACTIVE' ? 'EXPIRED' : c.status,
        startsAt: c.startsAt, endsAt: c.endsAt, testMode: c.testMode, rules: c.rules, promoterId: c.promoterId,
        shareUrl: `https://www.flupflap.com/join?promo=${encodeURIComponent(c.code)}`, funnel,
        qualifiedCustomers: qualifiedCustomers.length, successfulRecharges: redeemed._count,
        conversionRate: funnel.LANDING_VIEWED ? qualifiedCustomers.length / funnel.LANDING_VIEWED : null,
        promotionalCostCents: redeemed._sum.benefitCents ?? 0, attributableFeeCents: redeemed._sum.feeCents ?? 0,
        rewards: rewards.map(r => ({ status: r.status, count: r._count, amountCents: r._sum.amountCents ?? 0 })),
      };
    }));
  }
}
