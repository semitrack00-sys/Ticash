# FlupFlap marketing, referrals and promotions

## Release scope and activation

This change adds persistent acquisition tracking and a sandbox promotion/reward foundation. It does not activate a production campaign, change DNS, deploy, run a production migration, make a payment/recharge, or execute a payout.

Both new environment flags default to `false`:

- `FLUPFLAP_MARKETING_ENABLED`: enables the database-backed marketing API and repository hooks after the migration is reviewed/applied through the normal release process.
- `FLUPFLAP_MARKETING_SANDBOX_BENEFITS`: separately allows fee benefits on sandbox quotes. It cannot enable live monetary campaigns.

Production campaigns accept only `NONE` customer benefit and `NONE` promoter reward. API validation, quote/reward checks and SQL constraints enforce this independently. Test rewards cannot become `PAID`. Changing a feature flag is insufficient to enable real promotional money. A separately reviewed financial launch is required.

## Persistent architecture

`202609301800_flupflap_marketing/migration.sql` adds ReferralCode, Promoter, PromotionCampaign, CampaignVisit, ReferralAttribution, CampaignEvent, PromotionRedemption, PromoterReward and PromotionAuditEvent. Promotion codes are unique fields on campaigns rather than a redundant table. Existing transaction/quote principals are not rewritten. The migration adds foreign keys, unique replay keys, indexes, financial constraints and an append-only audit trigger.

The complete migration chain was executed only against disposable in-process PostgreSQL (PGlite). No external database or production migration was used. Prisma validation and generation passed.

Registered active FlupFlap customers receive a stable cryptographically random 128-bit referral code. Referral URLs contain no account IDs or PII. Anonymous visits use random 256-bit capabilities; only SHA-256 hashes and expiry are stored. The capability gives no authentication/payment access. An expiring HttpOnly cookie can reuse the visit across navigation; frontend copies remain memory-only. Browser privacy settings can prevent cookie reuse, so landing counts are visits, not a claim of unique humans.

Attribution is one immutable record per customer and one claimant per visit, acquired using real FlupFlap authentication. Self-referrals, promoter self-attribution, expired/replayed visits and disallowed guests are rejected. Existing identity uniqueness restrictions remain in force; this is not a claim that multiple real-world identities can be perfectly detected. Referral attribution is for new registered accounts; campaigns may explicitly permit guests/existing customers. Promo wins a conflicting referral unless `allowReferralAttribution` explicitly permits nonmonetary referral co-attribution. There is still only one campaign/discount/reward recipient.

## Endpoints and authorization

Public, rate-limited, no-store:

- `POST /api/flupflap/marketing/visits`
- `POST /api/flupflap/marketing/signup-started`

Existing FlupFlap authentication plus recharge/account restriction middleware:

- `GET /api/flupflap/marketing/share`
- `GET /api/flupflap/marketing/share/qr`
- `POST /api/flupflap/marketing/attribution`
- `GET /api/flupflap/marketing/quotes/:id` (owner only)

Existing TiCash staff authentication and `recharge.configuration.view` protect `/api/admin/flupflap/promotions`, `/promoters`, `/rewards`. Campaign/promoter writes and reward changes require `recharge.configuration.manage`; `/audit` additionally requires `audit.view`. Customer tokens and FlupFlap tokens cannot become staff credentials. New response DTOs do not expose customer/payment PII to promoter reports.

The service's optional promoter filter prepares a future portal but is not a public promoter endpoint. A future portal must derive that filter from a verified identity; accepting a browser-selected promoter ID would be unsafe.

## Fee and reward rules

Campaigns configure dates, status, country/operator/product/customer eligibility, new/first-recharge restrictions and total/per-customer caps. Codes normalize uppercase. Revocation is terminal; campaign owner/code/test mode cannot be silently replaced. Configuration changes record staff identity, reason, before/after snapshot and version.

Sandbox customer benefits: fee credit, fixed discount, fixed reduced fee, percentage of fee in basis points, waived fee, or none. Every benefit is capped at the original fee. Principal, provider amount, FX and delivered value are untouched. Wallet credits, principal subsidies and unspecified benefit types are rejected until an approved funded accounting model exists. Percentage rounding is explicitly downward to integer cents.

New quote creation locks customer/campaign rows, validates eligibility, reserves capacity, snapshots campaign rules and stores the discounted fee/total atomically. Historical quotes and replayed reservations are not repriced. Unconsumed expired reservations release capacity; in-flight payments retain it. The existing Stripe session consumes the stored server quote total. Browser quote requests still cannot submit a fee, discount, reward or total. The optional customer quote DTO displays original fee, benefit and first-recharge terms.

Rewards are separate from customer discounts: fixed customer, fixed recharge, percentage of eligible fee or milestone. A click/signup never earns one. Repository reconciliation observes persisted captured payment AND delivered fulfillment with provider/payment IDs and matching environments. It cannot call Stripe or Reloadly. Unique transaction/redemption constraints, locks and a final fulfilled state prevent duplicate rewards, including delayed milestone replays. Failure/refund/recovery reverses rewards once. Manual changes require ordered `PENDING -> APPROVED -> PAYABLE -> PAID` transitions or reasoned `REVERSED`, with audited staff identity. No payout executor exists; sandbox `PAID` is forbidden.

## Admin metrics and limitations

The existing Flutter FlupFlap Admin adds Promotions / Influencers without replacing other sections. Each campaign shows persisted landing views, signup starts, created accounts, unique qualified customers, eligible fulfilled recharges, conversion, customer promotional cost, attributable fees and separate reward statuses. Failed/unavailable requests show unavailable rather than invented totals. Test campaigns are labeled separately from real revenue.

The display returns the 100 most recent campaigns/ledger records; each campaign aggregate covers its full history. There is no TiCash remittance aggregation. Refunds remove reversed redemptions from eligible totals; recorded funnel events remain historical events. Administrator retention policy, multi-instance PostgreSQL load testing and a separately approved monetary launch remain operational follow-ups. PGlite concurrency tests serialize database transactions; they are not a substitute for multi-connection production load testing.

## Validation

- Backend: 763 tests passed / 0 failed, 34 files, including 47 new marketing policy/integration cases.
- Prisma validate/generate, TypeScript typecheck, ESLint, build and diff check passed.
- Flutter: analyze passed; 76 tests passed; release web build passed (Flutter 3.47.1 / Dart 3.13.1). Existing WebAssembly dry-run/secure-storage and Cupertino-font warnings remain; the JavaScript web build succeeded.
- Actual migration chain, API authorization, opaque referrals/QR, country/product/caps, replay, quote/Stripe totals, campaign mutation history, refunds, test payout blocking and SQL fail-closed checks are covered.
- Dependency audit: 4 inherited advisories (3 moderate, 1 high). Production-only audit: 1 moderate `ip-address` advisory. Existing versions of `ip-address`, `vitest`, `@vitest/mocker` and `brace-expansion` are unchanged; no advisory comes from the QR addition. Do not interpret this as a clean audit.
- Local screenshot artifacts (fixture data only, not production assets): `op/artifacts/marketing-admin-390.png`, `marketing-admin-1440.png`, `marketing-join-{390,430,768,1440}.png`, `marketing-share-{390,430,768,1440}.png`.

The website is a coordinated separate repository PR. No production activation is implied by merging code. Review both PRs and the existing baseline failures before release.
