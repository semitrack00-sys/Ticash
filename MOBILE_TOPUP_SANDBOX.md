# Worldwide Mobile Recharge Sandbox

TiCash Mobile Recharge remains a product boundary separate from international
money remittance. It has its own saved recipients, provider-backed quotes,
transactions, history, receipts, idempotency keys, and provider/payment
interfaces. It reuses the generic immutable ledger and audit infrastructure
without creating a MonCash, NatCash, bank, or remittance money transfer.

## Safety status

- Coverage: only provider-supported Reloadly Sandbox countries and operators.
- Provider: Reloadly Airtime Sandbox.
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
MOBILE_TOPUP_FEE_USD=3.50
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
countries, active operators, fixed/range denominations, and data-plan names
are read from Reloadly at runtime. TiCash does not hard-code universal
coverage, live pricing, exchange rates, or remittance corridor changes.

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

The test/development example sets `MOBILE_TOPUP_FEE_USD=3.50`. The config loader's existing fallback remains unchanged; configure the fee explicitly on the test backend. A provider amount of `5.00` then yields `feeUsd:3.50` and `totalChargeUsd:8.50`. Quotes and purchases remain backend-authoritative; client-supplied fee/total fields are rejected. No browser fee calculation is needed.

The website upgrade depends on the new country field and guest endpoint. Review the backend migration/API before rolling out the website upgrade; older mobile clients can ignore the additive field. No rollout is performed by this implementation.

Authenticated routes are under `/api/mobile-topups`:

- `GET /status`
- `GET /countries`
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

`POST /api/mobile-topups/payment-sessions` requires an `Idempotency-Key` and a strict body `{quoteId, recipientId?}`. It rejects payment methods/providers, price/fee/currency/status overrides, PAN/CVV/expiry and bank fields. No card form is needed. The service retrieves the owner's valid quote, checks any saved recipient, and atomically consumes/reserves it. The existing unique quote and user/key constraints plus conditional database updates prevent concurrent independent attempts. The response contains MOCK/SANDBOX, `transactionId`, `paymentSession.id`, `amountMinor`, `currency:USD`, and `paymentStatus`. The $5.00 + $3.50 quote becomes exactly 850 USD minor units; there is no client fee calculation.

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
