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
