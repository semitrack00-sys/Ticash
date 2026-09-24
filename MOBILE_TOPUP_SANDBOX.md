# Worldwide Mobile Recharge Sandbox

TiCash Mobile Recharge remains a product boundary separate from international
money remittance. It has its own saved recipients, provider-backed quotes,
transactions, history, receipts, idempotency keys, and provider/payment
interfaces. It reuses the generic immutable ledger and audit infrastructure
without creating a MonCash, NatCash, bank, or remittance money transfer.

## Safety status

- Coverage: union of actual enabled sandbox provider country/operator catalogs.
- Providers: Reloadly Airtime Sandbox primary; DT One pre-production optional secondary.
- Billing: USD in the TiCash Sandbox checkout flow.
- Payment: explicit mock authorization; Dwolla ACH is not used.
- Recurring recharge: architecture-only and unavailable.
- Production recharge: unavailable and fail-closed.
- `MOBILE_TOPUP_PRODUCTION_ENABLED=false`
- `MOBILE_TOPUP_APPROVED_FOR_LIVE_USE=false`
- `RELOADLY_ENVIRONMENT=sandbox`
- `APPROVED_FOR_LIVE_USE=false`
- `LIVE_MONEY_ENABLED=false`

The API never marks an order delivered from a client request. `DELIVERED` is
mapped only from a successful provider submission/status response. Unknown
provider states remain pending. The client cannot supply an operator catalog,
country override for a bound quote, denomination, delivery amount, or final
status.

## Backend configuration

Copy the placeholder names from `.env.example` and configure the TiCash API
process only. Never put Reloadly credentials in Flutter or source control.

```dotenv
MOBILE_TOPUP_ENABLED=true
MOBILE_TOPUP_PAYMENT_MODE=mock
MOBILE_TOPUP_BILLING_CURRENCY=USD
RELOADLY_ENVIRONMENT=sandbox
RELOADLY_CLIENT_ID=your-sandbox-client-id
RELOADLY_CLIENT_SECRET=your-sandbox-client-secret
RELOADLY_AUTH_URL=https://auth.reloadly.com/oauth/token
RELOADLY_AIRTIME_BASE_URL=https://topups-sandbox.reloadly.com
MOBILE_TOPUP_PRODUCTION_ENABLED=false
MOBILE_TOPUP_APPROVED_FOR_LIVE_USE=false
APPROVED_FOR_LIVE_USE=false
LIVE_MONEY_ENABLED=false
```

The API uses Reloadly's server-side client-credentials token flow. Available
countries, active operators, and fixed denominations are read from Reloadly at
runtime. TiCash does not hard-code universal coverage, live pricing, exchange
rates, or remittance corridor changes.

After reviewing the schema change in a local Sandbox database, apply the
reviewed migration instead of `prisma db push` for production-like environments.
Local Sandbox validation can still use `npm run prisma:validate`,
`npm run prisma:generate`, and a reviewed migration/test database rollout.

## API

### Accounts and guest test sessions

`POST /api/auth/register` is unchanged: first name, last name, email, and password create a normal persistent customer when `DATABASE_URL` is configured, returning access/refresh tokens. The existing in-memory test/development fallback is not permanent storage.

`POST /api/auth/guest` accepts no credentials (empty body or `{}`), creates a unique database customer with a random internal `.invalid` email and a bcrypt hash of a server-generated random password, and returns `{guest:true, expiresAt, user, accessToken, refreshToken}`. Only `CUSTOMER` is allowed, KYC remains `NOT_STARTED`, and payout restriction starts enabled. Guest accounts cannot be promoted to staff; permission resolution treats them as customers even if their stored role is corrupted. Account locks and funding restrictions still apply.

Guest access requires explicitly enabled recharge with sandbox environment, mock payments, false production/live approval flags, and the sandbox provider URL. Creation is limited to five attempts per IP per 15 minutes (including successful attempts), in addition to the existing API limiter. Guest access and refresh fail closed if these gates change. Outside the test suite, missing database storage returns `503 GUEST_STORAGE_UNAVAILABLE`; there is no fake client authentication or anonymous purchase route.

Guest credentials are recharge-only: only `/api/mobile-topups/*` uses guest-aware authentication. All normal authenticated routes reject guests with `403 GUEST_SCOPE_RESTRICTED`, including profile reads/updates, password changes, KYC, funding, remittances, recipients, and admin routes. Guests cannot attach permanent profile information or reserve a unique profile phone number. Refresh and logout remain available through their existing token endpoints; refresh never extends the guest deadline.

### Proxy configuration and guest rate limiting

Set `TRUST_PROXY_HOPS` to the **verified number of trusted proxy hops for the deployment**, including deployments behind Render. Do not assume Render always means one hop. Missing/blank disables proxy trust; otherwise only integers 1 through 10 are accepted. Invalid values, including `true`, fail configuration validation. Express receives the bounded hop count before any rate limiter is registered, never blanket `trust proxy=true`.

Verify every ingress path and ensure the trusted proxies sanitize forwarded headers; an untrusted caller must not be able to reach the API through a shorter path or impersonate a trusted hop. With the verified count, Express resolves the client IP for the existing API limiter and the guest five-attempts-per-15-minute limiter. These existing in-memory limiters operate per API process; sharing limits across multiple replicas requires a separate shared-store configuration.

In `NODE_ENV=production`, missing/blank `TRUST_PROXY_HOPS` blocks guest creation, existing guest recharge access, and guest refresh with `403 GUEST_PROXY_CONFIGURATION_REQUIRED`. Normal permanent-account routes remain available. Direct local/test operation can keep proxy trust disabled. No client-IP diagnostic endpoint is exposed. Proxy settings are read when the app is created, so configuration changes require an app restart.

Guest identity and refresh-token lifetime is one hour from creation; refresh rotation never extends that deadline. Access JWTs use the existing issuer/audience and at most 15 minutes, bounded by guest expiry. Stored expiry is also checked on authenticated requests. Browser tokens remain memory-only, so leaving/reloading ends access to that guest identity. Test records are retained for audit, not automatically deleted, and do not transfer to a subsequently registered account. A future retention policy may archive expired guests separately.

Before using this API version with a database, review and apply `migrations/202609221600_guest_customer_expiry/migration.sql`, then generate the Prisma client. It uses `ADD COLUMN IF NOT EXISTS` for the nullable column and leaves existing accounts permanent without rewriting records. This change does not run migrations, deploy services, change provider credentials, or enable live gates.

### Calling codes and fee

Country responses add `callingCode`, for example `{code:'HT', name:'Haiti', callingCode:'+509'}`. Codes come from the maintained [libphonenumber-js dataset](https://github.com/catamphetamine/libphonenumber-js), not provider area-code strings or a hand-maintained subset. Supported provider country identities and availability are preserved. US, Canada, Dominican Republic, and Jamaica retain distinct ISO codes with the shared `+1`.

Valid two-letter provider destinations without supported calling-code metadata are omitted from the public catalog. For example, Reloadly's legacy `AN` (Netherlands Antilles) is excluded while `HT` remains available with `+509`. No prefix is invented, and `AN` is never mapped to CW, SX, BQ, NL, or another ISO destination. A warning contains only the skipped validated country codes, without provider names, credentials, tokens, or phone numbers. Successful filtered catalogs retain the existing cache and sorting behavior. Malformed provider data still fails with a controlled `502 INVALID_PROVIDER_RESPONSE`; it is not silently skipped. If a nonempty provider catalog has no supported destinations, the endpoint returns `502 UNSUPPORTED_CALLING_CODE` without caching a healthy empty result. A genuinely empty provider catalog retains the existing empty-list behavior.

Approved customer-facing recharge pricing is fixed in the backend and does not use a flat `MOBILE_TOPUP_FEE_USD` override. The approved grid is `$5.00 → $0.99`, `$10.00 → $1.05`, `$20.00 → $1.49`, `$30.00 → $1.79`, `$50.00 → $2.49`, `$75.00 → $3.49`, and `$100.00 → $4.49`. Quotes and purchases remain backend-authoritative; client-supplied fee/total fields are rejected. No browser fee calculation is needed.

The website upgrade depends on the new country field and guest endpoint. Review the backend migration/API before rolling out the website upgrade; older mobile clients can ignore the additive field. No rollout is performed by this implementation.

Authenticated routes are under `/api/mobile-topups`:

- `GET /status`
- `GET /countries`
- `GET /coverage`
- `GET /operators?country=JM`
- `GET /operators/detect?country=JM&phone=+1876...`
- `GET /operators/:id/products?country=JM`
- `GET|POST /recipients`
- `POST /quotes`
- `POST /transactions` with an `Idempotency-Key` header
- `GET /transactions`
- `GET /transactions/:id?refresh=true`
- `POST /transactions/:id/repeat`

Recharge quotes bind the destination country, phone, operator, product, and
provider amounts into an immutable snapshot. Purchases use the quote snapshot,
not a client-supplied country change.

The test payment adapter is deliberately separate from remittance funding. A
production card/wallet funding provider, live recharge approval, and any future
remittance corridor changes require separate reviewed implementations.

## Phase 1 payment foundation

The active recharge payment provider remains **MOCK**. Keep `MOBILE_TOPUP_PAYMENT_MODE=mock`, `PAYMENTS_MODE=mock`, `RELOADLY_ENVIRONMENT=sandbox`, and all live/production approval gates false. This PR makes no Checkout.com payment, Dwolla transfer, or real Reloadly request and performs no deployment or database migration application.

`GET /api/mobile-topups/payment-methods` uses the existing recharge authentication and funding-restriction middleware. It represents CARD, APPLE_PAY, GOOGLE_PAY and BANK_ACCOUNT separately from providers MOCK, CHECKOUT_COM and DWOLLA. Only CARD/MOCK ("Test card — Sandbox") is available when recharge is enabled. Apple Pay and Google Pay are unconfigured. Bank recharge is unavailable to everyone; guests additionally receive `GUEST_SCOPE_RESTRICTED`. Guest authentication, expiry, permanent-account funding/KYC/remittance restrictions, and `TRUST_PROXY_HOPS` behavior are unchanged.

`POST /api/mobile-topups/payment-sessions` requires an `Idempotency-Key` and a strict body `{quoteId, recipientId?}`. It rejects payment methods/providers, price/fee/currency/status overrides, PAN/CVV/expiry and bank fields. No card form is needed. The service retrieves the owner's valid quote, checks any saved recipient, and atomically consumes/reserves it. The existing unique quote and user/key constraints plus conditional database updates prevent concurrent independent attempts. The response contains MOCK/SANDBOX, `transactionId`, `paymentSession.id`, `amountMinor`, `currency:USD`, and `paymentStatus`. The $5.00 + $0.99 quote becomes exactly 599 USD minor units; there is no client fee calculation.

Session creation does not send airtime or authorize a payment. Confirm with the existing `POST /transactions`, the same quote/recipient and the **same key**. This authorizes once through the working mock adapter, persists the authorization/provider identifiers, and calls the shared `fulfillPaidRecharge`. Older clients can continue to call `/transactions` directly. Retries return the same logical attempt, including after the already-reserved quote expires. A different key cannot reuse a consumed quote; the same key with changed quote/recipient is a 409. After a definite failed payment, a customer must request a fresh quote for a new attempt. An unknown outcome requires reconciliation before a new attempt.

### Persistence and recovery

Migration: `migrations/202609230900_mobile_topup_payment_foundation/migration.sql`. It adds nullable method/provider/session/provider-payment metadata, operation claim timestamps, a recovery code, expanded payment enum values, reconciliation indexes, and a deduplicated payment-event table. It preserves legacy NULL metadata and original statuses without relabeling existing records. PostgreSQL 12+ is required for the multi-value enum addition. Review the additive SQL against Prisma's offline schema diff before separately applying it to an approved database. No `db push`, migration apply, Render or database connection was used here.

Database compare-and-set updates claim authorization, fulfillment and recovery before external effects. The immutable transaction snapshot and stable Reloadly custom identifier are used for fulfillment. A claim is **not** automatically released after a timeout or process crash: that could send airtime or charge twice. A crash between claim and result persistence, ambiguous provider timeout, late capture after failure, or reversal after fulfillment needs operator reconciliation using the TiCash transaction, payment session/payment ID and Reloadly identifier. No unattended retry worker or live operations endpoint is enabled in this phase.

Definite recharge rejection/failure starts `VOID_PENDING` for an authorization or `REFUND_PENDING` for a captured payment. Mock recovery can confirm its deterministic result. A hosted recovery never falls back to a mock refund. Uncertain or unsupported recovery stays pending with a sanitized audit. Reloadly's reversal is not proof of a card refund: only the payment provider's confirmation changes payment status to REFUNDED. The existing mock reversal test remains compatible. Provider statuses and recovery codes remain distinct from top-up delivery status.

### Disabled Checkout.com adapter

`CheckoutSandboxPaymentProvider` is **not selected or instantiated by createApp**. The payment-session endpoint stays MOCK even if sandbox configuration is populated. `CHECKOUT_COM_ENABLED=false` by default, and the webhook endpoint responds 503 while disabled. Enabling its configuration only permits verified webhook receipt; it does not switch the recharge payment mode. Production is rejected. An enabled configuration without sandbox keys, webhook signing key, an account-specific HTTPS sandbox base URL, a valid processing channel ID, and server-configured success/failure URLs fails closed at startup. The URL and processing channel have no hardcoded defaults: read `CHECKOUT_COM_API_BASE_URL` and `CHECKOUT_COM_PROCESSING_CHANNEL_ID` from server environment configuration. The latter becomes `processing_channel_id` in the adapter request. Existing configured credentials are never read into source or documentation. Keep `CHECKOUT_COM_ENABLED=false` even when these settings exist.

The future adapter uses the current Flow Payment Sessions endpoint, USD minor units, and a compact immutable TiCash transaction reference (no phone/name/secrets). Billing country must come from separately verified customer billing context, never the airtime destination; it is not accepted by this phase's public endpoint. It restricts sessions to cards until wallet methods are separately approved/configured. Session creation has **no automatic HTTP retries**: the documented Flow create-session contract does not promise a session idempotency header. Before connecting it to public checkout, add durable hosted-session creation/reconciliation and a reviewed lifecycle for the client session token. This phase stores no session tokens or full session responses. All adapter HTTP tests inject mock transport.

The adapter preserves the unmodified validated Payment Session object for Flow initialization and provides a separate contract with provider, environment, TiCash transaction ID and public sandbox key. Only the **public key** and provider-intended client session object may reach the future website. Secret API keys and webhook signing keys are backend-only. Responses that echo server secrets are rejected, and provider errors are sanitized. Raw card, bank and wallet credentials are neither accepted nor added to the schema. The separate query, capture, session and recovery interfaces do not require mock providers to pretend to support hosted operations. A 202 capture/void/refund acknowledgement remains pending; it is not evidence of completed recovery.

### Verified webhooks and fulfillment

`POST /api/webhooks/checkout` captures raw JSON bytes before the JSON middleware. Signature verification uses the documented `Cko-Signature` HMAC-SHA256 with the separate webhook signing key and a constant-time comparison. No unsigned or browser-provided success signal can call fulfillment. No success URL or callback endpoint changes payment state.

The foundation accepts only the reviewed approval/capture/decline/void/refund event types, validates the immutable reference, exact full USD amount, persisted hosted session and payment identity, and stores event ID/hash/transaction/processing timestamp only. No full payloads or session secrets are logged or stored. Duplicate event IDs with changed bytes fail closed. Repeated deliveries can resume processing but cannot reclaim fulfillment. Approval alone does not send airtime: **CAPTURED** is required for CHECKOUT_COM. Full refund/void events arriving ahead of capture prevent later airtime; late conflicting captures and reversals are flagged for reconciliation. Subscribe only to these supported event types when a future sandbox rollout is approved; partial captures/refunds and other events are deliberately rejected for review.

Official references reviewed for this implementation:

- [Flow Payment Sessions API](https://api-reference.checkout.com/tag/Flow/#operation/CreatePaymentSession): required billing/redirect fields, minor units and unmodified Flow response.
- [Flow integration](https://www.checkout.com/docs/get-started): webhook confirmation before fulfillment, including synchronous browser callbacks.
- [Webhook receiver and signature verification](https://www.checkout.com/docs/developer-resources/event-notifications/receive-webhooks/configure-your-webhook-server): signing key, SHA-256 HMAC and raw payload.
- [Approved event](https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_approved), [captured event](https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_captured), [declined event](https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_declined), [refunded event](https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_refunded), and [voided event](https://www.checkout.com/docs/developer-resources/event-notifications/event-types/payment_voided): provider event identities, references, amount and currency.

Run `npm ci`, `npm run prisma:validate`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm audit --omit=dev`. Tests use in-memory stores, mocked Prisma clients and injected provider transports; database migration execution and real provider integration are separate future validation gates.


## Global recharge provider routing

Reloadly remains the primary discovery provider and its numeric operator IDs and
`reloadly:JM:255:airtime:5.00` product IDs remain unchanged. DT One is an optional
secondary pre-production provider; DingConnect is an optional UAT-only third provider, also disabled by default. Country discovery queries every enabled provider and
returns the sorted union of actual catalog entries. A failed/malformed provider
catalog is excluded, with a sanitized reason in coverage, while healthy provider
results remain available. If every provider fails, discovery returns a controlled
502. The existing calling-code filter still excludes unsupported destinations
such as AN without inventing a prefix. ISO metadata alone never adds availability.
There is no guarantee of coverage for literally every sovereign state or of a
purchasable product for every catalog destination. DT One availability and prices
depend on the account pricelist and supported transaction requirements.

### Optional DT One configuration

Configure only the backend environment, leaving the default disabled:

```dotenv
DTONE_ENABLED=false
DTONE_API_KEY=
DTONE_API_SECRET=
DTONE_BASE_URL=https://preprod-dvs-api.dtone.com/v1
```

The adapter uses HTTP Basic authentication (API key as username, API secret as
password), never client-side credentials. Enabling without credentials fails
startup; any other URL, including production, is rejected. Live approval/money
flags must remain false. Keep `CHECKOUT_COM_ENABLED=false`, `PAYMENTS_MODE=mock`
and `MOBILE_TOPUP_PAYMENT_MODE=mock`. This implementation does not edit deployed
environments, activate an account, or perform provider transactions.

Countries, operators, products and mobile lookup are paginated. ISO alpha-3/alpha-2
conversion uses `i18n-iso-countries`, never country-name guessing. Only Mobile
service 1 and Airtime/Bundle/Data subservices 11/12/13 are eligible. Initially only
fixed-value recharge products with USD source amounts representable in cents,
matching USD wholesale amounts and zero additional provider fee are exposed.
Ranges, FX/non-USD pricing, discounts/different wholesale prices, provider fees,
and unsupported sender/beneficiary/account/compliance requirements remain gated.
A product must explicitly declare requirements compatible with the mobile number
TiCash supplies. Unknown or absent requirements fail closed. Non-monetary data
allowances are not mislabeled as a delivered currency amount.

### Immutable provider identity and recovery

Global operator IDs use slots of 700000000: Reloadly 0, DT One 1, DING 2. Raw IDs
must be 1 through 699999999, and public IDs remain positive PostgreSQL Int values.
Quotes and transactions snapshot the provider, public operator, exact product ID,
raw provider product ID where applicable, amount/currency, delivered value when
known, fee, total and expiration. Saved recipients persist the selected provider.
The additive migration is
`migrations/202609240900_global_recharge_provider_router/migration.sql`: add DTONE
to the existing enum, nullable recipient provider and nullable quote/transaction
providerProductId fields; backfill existing selected recipients as RELOADLY.
Review/apply this migration separately before using the new Prisma client against
a deployed database. No migration is applied by this task and no db push is used.

Provider fallback is permitted only during discovery. A paid quote routes only to
its owner. DT One rechecks the exact product and quoted source price before its
one-step asynchronous transaction; a changed/ineligible product is rejected,
never substituted. The normalized E.164 number is sent as
`credit_party_identifier.mobile_number`. The SHA-256 of TiCash's stable custom
identifier, truncated to 40 hexadecimal characters, supplies a deterministic
DT One external_id. The existing database fulfillment claim prevents replay;
there is no automatic retry of uncertain submissions. Such attempts retain the
existing reconciliation-required state. Definite failure uses the existing
payment void/refund recovery path; airtime reversal alone is not payment refund
confirmation.

New provider transaction references include the provider prefix; historical
unprefixed references still route to Reloadly. Status refresh uses only the
original provider and validates the returned transaction ID. DT One status class
COMPLETED maps to DELIVERED, CREATED to PENDING, CONFIRMED/SUBMITTED to PROCESSING,
REJECTED/DECLINED/CANCELLED to FAILED, REVERSED to REFUNDED. Its raw status message
is stored separately. Unknown/malformed status responses fail safely without
claiming success. Guest scope, payment authorization, quote ownership, fees and
production gates are unchanged. The Jamaica $5 + $0.99 = $5.99 regression remains
covered with fixtures.

### Coverage and status

Authenticated `GET /api/mobile-topups/coverage` reports `uniqueCountries`,
per-provider enabled/count/reason values and sorted `overlapCountries`,
`reloadlyOnlyCountries`, `dtoneOnlyCountries` arrays. Counts use actual provider
catalogs after the same calling-code eligibility filter as public country
selection. Failed providers report zero and a sanitized reason; these counts
are degraded coverage, not proof that the failed provider has no destinations.
`GET /api/mobile-topups/status` reports the configured provider names and
SINGLE_PROVIDER/MULTI_PROVIDER mode, with sandbox/live flags unchanged.

After authorized pre-production credentials, migration and configuration have
been supplied, use an existing TiCash access token without printing it. Here
`TICASH_API_ORIGIN` is the backend origin without a trailing slash:

```powershell
$coverage = Invoke-RestMethod "$env:TICASH_API_ORIGIN/api/mobile-topups/coverage" -Headers @{ Authorization = "Bearer $env:TICASH_ACCESS_TOKEN" }
$coverage | Select-Object uniqueCountries, providers, overlapCountries, reloadlyOnlyCountries, dtoneOnlyCountries
```

Fixture tests verify routing and mapping without actual provider/database calls.
Account-specific discovery, eligible pricelist verification and authorized
pre-production purchase acceptance tests are still required before claiming
working DT One coverage.

Official contracts used:

- [Countries](https://developers.dtone.com/reference/getcountries), [operators](https://developers.dtone.com/reference/getoperators), [products](https://developers.dtone.com/reference/getproducts).
- [Fixed airtime fields and requirements](https://developers.dtone.com/docs/airtime-fixed-copy).
- [Asynchronous transactions](https://developers.dtone.com/reference/posttransactionasync), [transaction status](https://developers.dtone.com/reference/gettransactionbyid).
- [Mobile lookup](https://developers.dtone.com/reference/postlookupmobilenumber) and [lookup semantics](https://developers.dtone.com/docs/look-up-mobile-numbers).
- [Pagination](https://developers.dtone.com/reference/pagination) and [ISO code conversion](https://github.com/michaelwittig/node-i18n-iso-countries).


## DingConnect UAT provider

Ding uses the same documented API host for UAT and live accounts. `DING_ENVIRONMENT=uat`
is a local restriction, not proof of the credential's agent type. Use OAuth credentials
issued to a Ding **Test Agent**. Configuration defaults to disabled and accepts only
the reviewed URLs; missing enabled credentials or unsafe live/payment configuration
fails startup. Credential placeholders in `.env.example` remain blank:

```dotenv
DING_ENABLED=false
DING_ENVIRONMENT=uat
DING_CLIENT_ID=
DING_CLIENT_SECRET=
DING_OAUTH_TOKEN_URL=https://idp.ding.com/connect/token
DING_API_BASE_URL=https://api.dingconnect.com/api/V1
```

The existing router orders Reloadly, optional DT One, then optional Ding. No provider
namespace or database migration changes are needed. Ding's string ProviderCode is
converted losslessly to a positive raw integer (bijective base 63 over ASCII digits,
uppercase and lowercase letters), then passed to the existing DING slot helper.
Unrepresentable codes (including punctuation, overly long codes or overflow) are
omitted, never hashed or reassigned. Historical Reloadly and DT One IDs are unchanged.

OAuth client_credentials tokens stay in memory, expire according to expires_in, and
refresh early. Concurrent callers share one token request. Rejected tokens are cleared
without replaying a transfer. Errors expose only local sanitized messages; credentials,
raw error documents, provider status descriptions and tokens are not logged.

Discovery uses GetCountries, GetProviders, GetProviderStatus, GetProducts and
GetAccountLookup. Provider status must explicitly permit processing. XG is excluded
because it denotes global products, not a selectable country. Only exact, single
account matches are used for detection; nearest/ambiguous matches require manual
selection. Reference catalogs are unpaged under Ding's contract; unexpected pagination
is rejected rather than silently truncated. Transfer lookup uses ListTransferRecords
with DistributorRef, Take/Skip and ThereAreMoreItems. Duplicate/conflicting records
fail closed.

Initial product support is intentionally narrow: fixed equal Minimum/Maximum USD
SendValue, matching ReceiveValue/currency, zero CustomerFee/DistributorFee, mobile
Minutes/Data benefits, Instant processing, Immediate redemption, no settings,
bill lookup, regional restriction or extra instructions, and a valid provider-returned
UatNumber. Unsupported or ambiguous pricing/requirements are omitted; no SKU,
denomination or FX value is invented. Exact SKU is persisted as providerProductId.
Revalidation checks the exact operator/SKU/source amount before submission, without
substitution. A $5 fixture plus the approved $0.99 fee yields $5.99.

**The transfer guard accepts only the exact UatNumber returned for that SKU.** Ding
states those numbers do not debit balance even for live credentials; ordinary
recipient numbers are rejected. ValidateOnly is false only for this guarded UAT path;
validation-only responses are never called successful delivery. Some Ding UAT numbers
may fail TiCash's existing country/phone validation. That validation is not weakened;
such products require provider clarification before end-to-end UAT use.

DistributorRef is the stable `tc-` prefix plus 32 SHA-256 hex characters derived from
TiCash's immutable custom identifier. The existing durable fulfillment claim remains
the authority preventing duplicate effects across processes. A pre-submit lookup
recognizes an existing matching record. No automatic SendTransfer retry occurs. On a
lost response the adapter performs a lookup, then preserves PROCESSING/SUBMISSION_UNKNOWN
with a durable `DING:tc-...` providerTransactionId if still unresolved. Status refresh
queries that reference; operatorTransactionId stores Ding's actual TransferRef. A
missing lookup result is not proof of failure or permission to resend. The adapter
also suppresses repeated submissions in the same process after an attempted send.
A process crash remains subject to the existing operator reconciliation workflow;
recompute DistributorRef from the stored custom identifier if persistence was interrupted.
Do not release a fulfillment claim or retry blindly. Ding's lookup retention is two
months, so unresolved cases must be reconciled within that provider window.

Complete/Completed maps to delivered, Submitted/Processing/Cancelling to processing,
and Failed/Cancelled to failed. Raw status is kept separately. Definitive failure uses
the existing payment recovery; uncertainty never claims success or refund. No deferred
transfer callbacks, cancellation, real payment mode, or live activation is introduced.

Coverage uses the actual Ding catalog with existing calling-code filtering.
`overlapCountries` is the sorted, deduplicated list supported by at least two enabled,
available providers, including Ding. This preserves the original two-provider result
when Ding is disabled. `providerOverlaps.RELOADLY_DTONE` retains that exact pair
intersection; RELOADLY_DING and DTONE_DING expose the other pairs. A country shared
by all three appears once in overlapCountries and in each applicable pair. Disabled
or failed providers contribute no countries. Exclusive country arrays exclude both
other providers, with dingOnlyCountries added.
Per-provider failure/disabled reasons remain sanitized. Counts describe catalog
availability, not verified purchases or coverage of every country. Status lists Ding
only when the recharge feature and valid Ding configuration are enabled.

### First read-only UAT check (run separately when authorized)

Obtain Test Agent OAuth credentials and store them only in your protected local
environment/.env. The following commands make only an OAuth token request and catalog
GETs; the dedicated script explicitly prohibits transfer, payment and database calls.
It enables only its isolated adapter instance and does not edit .env or enable the API
server's Ding configuration. It prints counts only, never credentials or full documents.
Do not share terminal environment dumps or .env contents.

```powershell
Set-Location 'C:\Users\duken\Documents\Codex\2026-09-01\c\Ticash'
npm run build --workspace @ticash/api
node --env-file=.env tools/ding-uat-readonly.mjs
# Optional: examine eligible products for the first active operator of an actual catalog country.
$env:DING_UAT_COUNTRY='JM'
node --env-file=.env tools/ding-uat-readonly.mjs
Remove-Item Env:DING_UAT_COUNTRY
```

No account-authenticated UAT call was made during implementation. Remaining gates are
Test Agent credential/account access confirmation, actual catalog eligibility, and
separately authorized UAT acceptance tests. Test credentials have lower daily limits
for some operations; the read-only script samples one operator rather than scanning
all products. No schema migration, database mutation or deployment is required here.

Official references: [OAuth, result envelopes and paging](https://www.dingconnect.com/Api/Description),
[API methods and models](https://www.dingconnect.com/pt-BR/Api),
[UAT credentials, numbers and reconciliation guidance](https://www.dingconnect.com/Api/Faq),
and [Ding's SendTransfer contract](https://www.postman.com/dingconnect/dingconnect-public-workspace/request/262f54b/sendtransfer).
