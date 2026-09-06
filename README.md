# TiCash

See [ADMIN_OPERATIONS.md](ADMIN_OPERATIONS.md) for the staff dashboard roles, operational workflows, and production safety gates.

TiCash is a mobile-first remittance application. The initial and only customer-visible
receiving market is Haiti (`HT`), with Haitian gourde (`HTG`) payout through candidate
rails such as MonCash and NatCash. The country/provider boundaries are extensible, but
no other receiving country is active in this version.

## Current safety status

Payouts remain mock-only. An opt-in, backend-only Dwolla Sandbox adapter is available
for U.S. ACH UAT, but is disabled by default and cannot use Dwolla's production host.
It does not connect Dwolla directly to Haiti payout. Do not enable real-money transfers
until provider contracts, credentials, corridor authorization, KYC/AML controls,
reconciliation, legal review, and operational approval are complete.

## Security, compliance, and risk controls

The API now enforces account locks, independent funding/payout restrictions, backend
KYC authority, server-side roles, login-attempt lockout, idempotent money operations,
and a compliance gate between confirmed funding and payout. A funded transfer remains
in `COMPLIANCE_REVIEW` unless an actual sanctions/AML provider returns `CLEAR` or an
authorized administrator records a reviewed decision. The test-only
`SANDBOX_COMPLIANCE_AUTO_CLEAR` flag defaults to `false` and is rejected as a live-money
substitute.

Transaction and risk thresholds are configuration-driven. No regulatory limit has
been invented in source code. Set all four approved transfer limits before enabling
`TRANSFER_LIMITS_ENABLED=true`; otherwise the API refuses to start. Risk signals create
review flags and do not claim to be legal, sanctions, or AML determinations.

```dotenv
LOGIN_MAX_FAILURES=5
LOGIN_LOCK_MINUTES=15
TRANSFER_LIMITS_ENABLED=false
TRANSFER_LIMIT_PER_TRANSACTION_USD=
TRANSFER_LIMIT_DAILY_USD=
TRANSFER_LIMIT_WEEKLY_USD=
TRANSFER_LIMIT_MONTHLY_USD=
RISK_REVIEW_AMOUNT_USD=
RISK_MAX_TRANSFERS_24H=
RISK_MAX_DISTINCT_RECIPIENTS_24H=
RISK_MAX_FAILED_FUNDING_24H=
RISK_RECIPIENT_CHANGE_WINDOW_MINUTES=
DATA_RETENTION_DAYS=
SANDBOX_COMPLIANCE_AUTO_CLEAR=false
APPROVED_FOR_LIVE_USE=false
LIVE_MONEY_ENABLED=false
```

`DATA_RETENTION_DAYS` records a policy target only. This release intentionally has no
automatic deletion job: KYC, ledger, transfer, provider-event, and audit records must
not be deleted until counsel approves jurisdiction-specific retention and legal-hold
rules. Administrative restriction/compliance changes and reconciliation runs are
audited. Reconciliation reports discrepancies and never alters ledger entries.

Administrative controls:

- `PATCH /api/admin/users/:id/restrictions`
- `PATCH /api/admin/transfers/:id/compliance`
- `POST /api/admin/reconciliation/run`
- `GET /api/admin/reconciliation`

Didit webhooks prefer the current fully authenticated `X-Signature-V2` format and also
support the full raw-body `X-Signature` fallback, with a five-minute timestamp check and
event-ID idempotency. The envelope-only `X-Signature-Simple` fallback is intentionally
not trusted because it does not authenticate decision data. Dwolla webhooks verify the
raw request body using `X-Request-Signature-SHA-256` before parsing and use stored event
IDs plus payload hashes for replay/conflict protection.

## Canonical architecture

- `apps/mobile` — Flutter customer application for Android and iOS.
- `apps/api` — Express/TypeScript mock API implementing the mobile contract.
- `packages/shared` — shared API/domain types.
- `schema.prisma` — production-target PostgreSQL data model.
- `mobile` and the loose root Expo files — legacy prototypes retained for reference;
  they are not part of the supported build.

The API uses memory in automated tests and whenever `DATABASE_URL` is absent. Durable
development/UAT persistence uses the Prisma/PostgreSQL models. Funding data includes
provider customers, masked bank sources, idempotent ACH requests, webhook receipts,
and immutable balanced ledger transactions. Full bank account and SSN values are never
stored by TiCash.

## Local API setup

Requires Node.js 20 or newer.

```bash
npm ci
npm run dev:api
```

The API listens at `http://localhost:4000/api`. Health checks are available at
`GET /api/health` and `GET /api/v1/health`.

Initialize a development database after reviewing the schema:

```bash
npm run prisma:generate
npm run db:push
npm run db:seed
```

Use `DATABASE_URL` for the pooled application connection and `DIRECT_URL` for
Prisma schema operations. For Neon, obtain both values from the dashboard and
keep `sslmode=require`; the API normalizes that setting to explicit full
certificate/hostname verification. On Windows, the schema command uses an
ephemeral loopback bridge when connecting to Neon. The external Neon connection
still uses verified TLS; database credentials are never printed or stored by the
bridge. This avoids a machine-level Schannel credential failure without disabling
TLS or certificate validation.

The seed creates only U.S.-USD-to-Haiti-HTG Dwolla/MonCash and Dwolla/NatCash
candidate corridors. Every sandbox and live approval field is `false`.

## Dwolla Sandbox UAT

Copy `.env.example` to a local `.env`, keep every production gate `false`, and set:

```dotenv
DWOLLA_ENABLED=true
DWOLLA_ENVIRONMENT=sandbox
DWOLLA_CLIENT_ID=your-sandbox-client-id
DWOLLA_CLIENT_SECRET=your-sandbox-client-secret
DWOLLA_WEBHOOK_SECRET=your-sandbox-webhook-secret
DWOLLA_MASTER_FUNDING_SOURCE_URL=https://api-sandbox.dwolla.com/funding-sources/your-destination-id
DWOLLA_PRODUCTION_ENABLED=false
DWOLLA_LIVE_FUNDING_ENABLED=false
DWOLLA_APPROVED_FOR_LIVE_USE=false
```

Never put these values in Flutter, browser code, source control, screenshots, or logs.
With `DWOLLA_ENABLED=false`, no Dwolla credential is required and every funding action
returns the controlled `FUNDING_DISABLED` response. Customer creation and bank-source
operations require an authenticated user whose KYC status was approved by the backend.

Implemented sandbox endpoints:

- `GET /api/funding/status`
- `POST /api/funding/dwolla/customer`
- `GET|POST /api/funding/dwolla/funding-sources`
- `POST /api/funding/dwolla/funding-sources/:id/micro-deposits`
- `POST /api/funding/dwolla/funding-sources/:id/micro-deposits/verify`
- `PUT /api/funding/dwolla/funding-sources/:id/default`
- `DELETE /api/funding/dwolla/funding-sources/:id`
- `POST /api/funding/dwolla/transfers` (requires `Idempotency-Key`)
- `GET /api/funding/dwolla/transfers/:id?refresh=true`
- `POST /api/funding/dwolla/transfers/:id/cancel`
- `GET /api/funding/wallet`
- `POST /api/webhooks/dwolla` (raw-body HMAC verification)
- `GET /api/corridors` (Haiti-only receiving response)

Provider webhooks and explicit provider-status refreshes are the only paths that may
settle a pending ACH into the double-entry ledger. A settled ACH debits Dwolla clearing
and credits the user's USD wallet liability; a confirmed return posts the exact inverse.

The Flutter **Bank accounts** screen is available from Profile and from the Send Money
funding step. It submits routing/account values only for the active request, displays
only masked metadata afterward, supports checking/savings, micro-deposit verification,
default-bank selection, provider-side removal, and reloads provider-authoritative state.
Do not use memory mode for durable UAT: when `DATABASE_URL` is absent, bank enrollment,
verification attempts, defaults, and funding records are lost when the API restarts.

## Server-side FX quote engine

The U.S.-to-Haiti quote flow is backend-authoritative. The Flutter app requests a quote
and receives a short-lived `quoteId`, USD/HTG rate, TiCash fee, provider/funding fee,
total customer charge, exact HTG recipient amount, corridor, and expiration time. It
must submit that quote ID with the unchanged send amount, currencies, country, and
payout method. The server rejects expired, consumed, cross-account, altered, or
unsupported quote submissions and never accepts client-supplied rates or fee totals.

Development and UAT use an explicitly identified mock provider behind `FxProvider`:

```dotenv
FX_MODE=mock
FX_QUOTE_TTL_SECONDS=300
MOCK_FX_USD_HTG_RATE=132.500000
TICASH_FEE_PERCENT=2.5
TICASH_MINIMUM_FEE_USD=1.99
FX_PROVIDER_FUNDING_FEE_USD=0.00
```

`FX_MODE=mock` is rejected with `NODE_ENV=production`. The mock rate is test data, not
a market rate or an approved production quote. Live FX requires a separately approved
provider implementation and corridor activation.

## U.S. to Haiti sandbox send flow

The test flow is: approved KYC state → backend FX quote → Haiti recipient and enabled
payout method → transfer reservation → Dwolla Sandbox ACH request → provider-confirmed
funding → compliance decision → mock Haiti payout processing → administrator-confirmed test delivery. Transfer
creation alone never means that funding or delivery succeeded.

`MONCASH_SANDBOX_ENABLED` and `NATCASH_SANDBOX_ENABLED` control which mock payout
methods the backend exposes. Haitian bank payout remains unavailable. All sandbox
receipts are labeled as test data and the corridor keeps `approvedForLiveUse=false`.

The mobile app requests funding through `POST /api/transfers/:id/funding`, but the
backend obtains the exact charge from the stored quote. `GET /api/transfers/:id` is the
authoritative transaction-detail/receipt endpoint; the mobile detail screen refreshes
non-terminal transfers and reloads state when the app resumes.

Production remittance remains blocked pending Dwolla production approval, an approved
Haiti payout provider, and regulatory/compliance activation. No production payout API
has been invented to make the sandbox flow appear live.

## Didit identity verification

TiCash now has an opt-in, backend-authoritative Didit integration. It is disabled by
default and requires no credentials while disabled. Configure only the backend:

```dotenv
DIDIT_ENABLED=true
DIDIT_API_KEY=your-server-side-api-key
DIDIT_WEBHOOK_SECRET=your-webhook-destination-secret
DIDIT_WORKFLOW_ID=00000000-0000-0000-0000-000000000000
DIDIT_BASE_URL=https://verification.didit.me
```

The backend creates sessions with the official Didit v3 Sessions API and binds
`vendor_data` to the authenticated TiCash user ID. Flutter launches the official native
Didit SDK with the returned short-lived session token. Signed, timestamped, idempotent
webhooks are the primary authority for approval; the app cannot set its own KYC state.
TiCash stores status/session metadata only and does not store document or selfie images.
See [DIDIT_KYC.md](DIDIT_KYC.md) for endpoint and Business Console setup.

## Flutter setup

Requires Flutter 3.19 or newer.

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:4000/api
```

Use `http://10.0.2.2:4000/api` from an Android emulator. A physical device must
use the development machine's reachable LAN address and an appropriate firewall rule.

The Sandbox quote engine supports USD, CAD, EUR, MXN, BRL, CLP, and DOP as
sending currencies. Haiti remains the only receiving market and HTG remains the
only receiving currency. These rates are explicit mock/test configuration; no
non-USD production funding provider is enabled. Customer profiles use an
international address shape: country code, street lines, city/locality,
state/province/region, and ZIP/postal code.

## Validation

```bash
npm run prisma:validate
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

For the Flutter application:

```bash
cd apps/mobile
flutter analyze
flutter test
flutter build apk --debug
```

## Implemented mock flows

- Registration, login, access tokens, refresh-token rotation, logout, and session restore.
- Authenticated recipient create/list/update/delete with Haiti phone and payout-rail validation.
- Server-authoritative USD-to-HTG quotes with fees.
- Idempotent transfer submission and transfer history.
- Rate limiting, security headers, strict request validation, and bounded client token refresh.
- Backend-only Dwolla Sandbox OAuth, verified bank-source flow, ACH initiation/status/cancel,
  idempotent webhooks, and double-entry settlement/reversal posting.
- Backend-only Didit v3 session creation, signed/idempotent webhook status handling,
  server-side decision reconciliation, and native Flutter KYC onboarding.
- Haiti-only corridor discovery with every live-approval flag disabled.
- Haiti-only Mobile Recharge foundation with provider-returned Reloadly Sandbox
  operators/products, server-side quotes, saved recharge recipients,
  idempotent purchase submission, authoritative status refresh, history,
  receipts, and separate balanced ledger references. Payment remains mock and
  production is fail-closed; see [MOBILE_TOPUP_SANDBOX.md](MOBILE_TOPUP_SANDBOX.md).

## Production blockers

Dwolla production approval, approved live funding configuration, approved Haiti payout
providers, corridor/regulatory authorization, approved Didit workflow/credentials and
KYC policy, AML/sanctions screening, fraud controls, limits, operational reconciliation,
disputes/refunds, notifications, monitoring, backups, incident response, and penetration
testing remain required before processing money. MonCash, NatCash, Haitian bank payout,
and HTG/USD payout availability must never be inferred from UI or schema support.
