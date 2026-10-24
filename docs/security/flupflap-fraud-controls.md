# FlupFlap recharge fraud controls

This change is not a declaration that any buyer committed fraud. It adds conservative, reversible order holds.

## Implemented

- Production FlupFlap reservation requires an active registered, unrestricted customer (in addition to the existing route guest restriction).
- Customer row lock serializes concurrent reservations across API workers. All reservations in the rolling window count, including failed, refunded, and customer-hidden orders. Idempotent retries reuse the existing reservation.
- First seven account days: maximum $25 per order and $50 reserved per rolling 24 hours. Older accounts: $100 per order and $200 per 24 hours. All amounts include fees. Maximum three reservations per hour and ten per 24 hours.
- Stripe Checkout requests a 3DS challenge. The issuer controls whether a challenge occurs; this is not a liability guarantee.
- Before any new production FlupFlap Stripe fulfillment, retrieve the bound PaymentIntent and charge from Stripe. Require succeeded/captured payment, matching transaction metadata and environment, normal risk, no review/dispute/refund, and authenticated card evidence. Unknown or non-card results require review rather than automatic delivery.
- More than two observed paid-card fingerprints per buyer in 24 hours requires review. This does not count failed card attempts inside an existing hosted checkout; Radar must cover that path.
- Evidence is durable in RechargeFraudAssessment. Fingerprints are hashed. No card numbers or CVCs are stored. Transaction IDs join existing recipient and supplier-delivery evidence.
- Held orders remain PENDING/CAPTURED with FRAUD_REVIEW_REQUIRED and an internal reason. Webhook retries/reconciliation cannot automatically release them. Existing admin pending-failures view exposes the held records. No automatic refunds or fraud accusations.

## Deployment and operations

Apply migration 20261024010000_recharge_fraud_assessment and generate Prisma before deploying. Missing database/provider evidence fails closed into a hold. Review held payments promptly in Stripe and the admin dashboard. Investigate the supplier state before refunds. This first change deliberately has no override/release endpoint; a separately reviewed release workflow is required before deployment so legitimate held customers are not stranded. Do not clear the failure code directly as an operational workaround.

## Outstanding work — do not describe as enabled

Email/phone verification: timestamps exist but no customer verification flow currently sets them. Add and test expiring, single-use verification challenges, delivery providers, resend/attempt limits and mobile/web screens before enforcing those fields. Do not mark accounts verified from submitted profile data.

Device/IP controls, card-sharing across accounts, and repeated failed attempts within one Checkout Session require additional controls. Existing email blocks do not cover alternate emails. Merchant store-balance flows remain on their existing controls; this gate covers Stripe retail recharges.

No production deployment is performed by this branch. Prices and existing supplier protocols are unchanged. Test the migration and row-lock concurrency against a real PostgreSQL instance before merge.
