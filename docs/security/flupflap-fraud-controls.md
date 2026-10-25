# FlupFlap recharge fraud controls

This change is not a declaration that any buyer committed fraud. It adds conservative, reversible order holds.

## Implemented

- Production FlupFlap reservation requires an active registered, unrestricted customer (in addition to the existing route guest restriction).
- Customer row lock serializes concurrent reservations across API workers. All reservations in the rolling window count, including failed, refunded, and customer-hidden orders. Idempotent retries reuse the existing reservation.
- First seven account days: maximum $25 per order and $50 reserved per rolling 24 hours. Older accounts: $100 per order and $200 per 24 hours. All amounts include fees. Maximum three reservations per hour and ten per 24 hours.
- Stripe Checkout requests a 3DS challenge. The issuer controls whether a challenge occurs; this is not a liability guarantee.
- Before any new production FlupFlap Stripe fulfillment, retrieve the bound PaymentIntent and charge from Stripe. Require succeeded/captured payment, matching transaction metadata and environment, normal risk, no review/dispute/refund, and authenticated card evidence. Unknown or non-card results require review rather than automatic delivery.
- More than two observed card fingerprints per buyer or recently linked installation in 24 hours blocks new checkout and holds fulfillment. Signed failed-payment events and paid assessments both count. Hosted Checkout reveals card selection only after an attempt; Radar remains necessary for synchronous pre-authorization blocking.
- Evidence is durable in RechargeFraudAssessment. Fingerprints are hashed. No card numbers or CVCs are stored. Transaction IDs join existing recipient and supplier-delivery evidence.
- Held orders remain PENDING/CAPTURED with FRAUD_REVIEW_REQUIRED and an internal reason. Webhook retries/reconciliation cannot automatically release them. Existing admin pending-failures view exposes the held records. No automatic refunds or fraud accusations.

## Mandatory card verification passes

Production FlupFlap card delivery now requires both
`card.checks.address_postal_code_check === 'pass'` and `card.checks.cvc_check === 'pass'`.
Failed, unavailable, unchecked, not-provided, unknown, null and missing results all
hold fulfillment with `PAYMENT_CARD_CHECK_FAILED`. Normal risk, authenticated 3DS,
retries and staff review cannot override this requirement. Only result strings are
read; the backend never receives or stores CVC values.

The permanent Radar block is:

```
is_missing(:address_zip_check:) or :address_zip_check: != 'pass' or is_missing(:cvc_check:) or :cvc_check: != 'pass'
```

Explicit `is_missing` terms are necessary: comparisons and NOT do not match missing
Radar attributes. The rule applies at 100% traffic. Stripe collects card details;
issuers determine check results. This strict policy may decline legitimate issuers,
wallets or saved cards without supported checks and is not a zero-fraud guarantee.
Checkout always requests the full billing address to collect the postal code.
Existing payment risk, registration, authentication and purchase limits still apply.

Purchases were reopened at the owner's direction on 2026-10-24 using
`MOBILE_TOPUP_ENABLED=true`; the temporary transactionId blanket block is disabled.
The KYC rollout was cancelled and was never merged or enabled. This change does
not refund payments or release existing fraud holds.

## Deployment and operations

Apply migrations 20261024010000_recharge_fraud_assessment and 20261024020000_recharge_fraud_review and generate Prisma before deploying. Missing database/provider evidence fails closed into a hold. Review held payments promptly in Stripe and the admin dashboard. Investigate the supplier state before refunds. Authorized staff with recharge.reconciliation permission can POST /api/admin/flupflap/transactions/:id/fraud-review/release with a reason of 20–500 characters. Release requires fresh normal-risk, authenticated, captured, undisputed, unrefunded Stripe evidence and an active unrestricted customer. Approval is audited and bound to the charge and hashed card fingerprint; fulfillment checks evidence again. This permits reviewed card-velocity exceptions, never risk or authentication overrides. The mobile receipt and checkout resume response identify held payments and tell customers not to pay again. The staff transaction screen includes a reason-entry review action. Flutter validation remains outstanding. Do not clear the failure code directly as an operational workaround.

## Outstanding work — do not describe as enabled

Contact verification is implemented behind FLUPFLAP_VERIFICATION_ENABLED, default false. Apply migration 20261024030000_flupflap_verification, configure RESEND_API_KEY, FLUPFLAP_VERIFICATION_EMAIL_FROM and existing Telnyx settings, then enable delivery and test the Account screen. Six-digit codes expire in 10 minutes, are HMAC protected, single use, bound to account/channel/saved contact, limited to five guesses each and three sends per hour with a 60-second cooldown. Ten failed guesses per hour also prevent resending. Failed delivery invalidates the code. Confirmation is audited without recording the code.

Only after end-to-end delivery/app testing, set FLUPFLAP_REQUIRE_VERIFIED_CONTACTS=true to require both verified contact methods before new production recharge reservations. Startup rejects enforcement without both delivery providers. Existing held payments retain their independent review controls. Account possession verification is not identity verification or proof that a payment is legitimate. Configure challenge retention cleanup before rollout; rows contain contact data and cascade on customer deletion.

Device associations and signed failed-attempt tracking now cover the supported paths described below; Radar remains necessary for synchronous payment rejection. Existing email blocks do not cover alternate emails. Merchant store-balance flows remain on their existing controls; this gate covers Stripe retail recharges.

## Linked account safeguards

- A recipient's normalized E.164 number shares the established-account reservation budget across all production FlupFlap customers: three attempts/hour, ten/day, $200/day including fees. The customer's own limits still apply. Failed, hidden and refunded reservations count. PostgreSQL transaction advisory locks prevent concurrent accounts from racing this budget; an idempotent replay consumes no additional allowance. A recipient index supports the rolling-window lookup. Apply migration `20261024040000_recipient_fraud_limits` before deployment.
- The same hashed card fingerprint observed on another customer in the preceding 30 days causes `SHARED_CARD_REVIEW`, even when Stripe risk is normal. A link to an inactive or recharge-restricted customer causes `LINKED_ACCOUNT_REVIEW`. Card-scoped transaction locks serialize evidence writes across customers. Family/shared-card use is held for review, not classified as proven fraud. Staff may approve a legitimate shared-card exception with fresh safe evidence, but a link to a restricted account still prevents delivery.
- When Stripe returns a final network ECI for Visa/Mastercard, automatic delivery requires the authenticated network-specific value (05/02). The provisional 3DS ECI is not substituted for the final network response. Missing final ECI keeps the existing authenticated-3DS checks; this is not a guarantee of liability shift.
- Cross-account card checks only cover durable assessments collected by this gate; they cannot infer fingerprints from older payments without assessments. Keep known suspicious cards in Stripe's block list. Recipient limits apply before collecting payment; shared-card checks apply before supplier fulfillment because hosted Checkout does not reveal the chosen card beforehand.
- No device fingerprinting, IP bans, external alert delivery or mandatory SMS rollout is enabled by this change. Mandatory contact verification must remain staged until every supported checkout client and both delivery channels pass end-to-end testing.

No production deployment is performed by this branch. Prices and existing supplier protocols are unchanged. Test the migration and row-lock concurrency against a real PostgreSQL instance before merge.

### Installation controls and operational alerts

Production retail checkout associates a random first-party installation identifier
with a customer before payment. The API stores only its SHA-256 digest and deletes
associations after 30 days without a purchase attempt. A browser uses an HttpOnly,
Secure, SameSite=None cookie; updated native apps use secure app storage. Two
accounts may use one installation in 30 days; a third is rejected before payment.
A link to a restricted/inactive account is also rejected. This is an evadable risk
signal, not hardware identification or evidence of fraud. Existing native versions,
blocked cookies, storage resets and new devices are not covered by this signal.
Account, card and recipient protections remain independent. No geolocation, IP
fingerprinting or advertising identifiers are collected by this feature.

Set FLUPFLAP_FRAUD_ALERT_EMAIL to the owner's authorized address to activate the
Resend worker using existing RESEND_API_KEY and FLUPFLAP_VERIFICATION_EMAIL_FROM.
It queues current held production recharges and sends only a transaction reference
and the admin link, without customer contact or card data. Claims prevent parallel
sends; stable Resend idempotency keys cover ambiguous retries. Automatic retries
stop after 10 attempts or 23 hours (inside Resend's idempotency window). Inspect
FlupFlapFraudAlert.lastError/sentAt and FRAUD_ALERT_* logs if delivery fails. A hold
is a risk signal, not a fraud verdict; always inspect current payment status.

SMS verification now requires an unchecked explicit consent box and records the
consent version in the audit log before sending. Email remains independent. The
Telnyx 2FA campaign must be approved, its sender assigned, START/STOP/HELP responses
verified, and a real code delivered/confirmed before phone verification is required.
Do not enable FLUPFLAP_REQUIRE_VERIFIED_CONTACTS merely because this code deploys.
The worker deletes expired verification challenges after seven days.

### Additional attempt, street and recipient controls

- Three distinct signed Stripe failed-charge attempts within a rolling 15 minutes reject new retail checkout reservations and hold any pending delivery. Deduplicate by transaction plus Stripe charge ID in the existing AuditLog; fallback to the signed event ID when the charge is absent. Event occurrence time, not delayed webhook arrival time, controls the window. Only SHA-256 fingerprints, charge references and timestamps are retained. Existing events are not backfilled.
- One installation's recently associated accounts share failure and card limits. Resetting installation storage or using an old client can evade this signal; account and recipient limits remain independent. Missing card fingerprints cannot be inferred.
- After a signed failure crosses a limit, expire that order's open hosted Checkout Session. Provider errors leave the event unprocessed for Stripe retries. A session that completed concurrently still passes through the fulfillment gate. Other already-open sessions cannot be synchronously blocked by an asynchronous webhook; new reservations and later delivery are guarded. Do not describe these controls as preventing every authorization.
- A third distinct card within 24 hours (failed or paid) is held, and subsequent checkout reservations are rejected until the window clears. Staff release cannot override an active attempt/card limit. Existing holds remain durable after cooldown until audited review.
- Three distinct customer accounts reserving recharges for one recipient within an hour cause SHARED_RECIPIENT_REVIEW before delivery. Existing recipient reservation budgets remain unchanged. Staff may release a legitimate shared-recipient hold after fresh safe evidence.
- An explicit Stripe address_line1_check='fail' causes PAYMENT_STREET_CHECK_FAILED before supplier delivery, including retries and staff review. Missing/unavailable street results are not rejected solely for street verification. Mandatory passing CVC and ZIP remain unchanged.
- First-seven-days limits of $25/order and $50/rolling day were already present and remain enforced including fees.
- No new database migration is needed. The new attempt history uses idempotent audit rows and the existing customer/time index. Existing failed charges before this deployment are not counted.
- Stripe Dashboard street blocking remains a separate operational step: preview and enable `:address_line1_check: = 'fail'` at 100%. This branch does not create that Radar rule. Country matching was enabled by the owner in the Dashboard; recipient destination countries are not compared to card countries.
