# Haiti Mobile Recharge Sandbox

TiCash Mobile Recharge is a product boundary separate from international money
remittance. It has its own saved recipients, provider quotes, transactions,
history, receipts, idempotency keys and provider/payment interfaces. It reuses
the generic immutable ledger and audit infrastructure without creating a
MonCash or Natcash money transfer.

## Safety status

- Destination: Haiti (`HT`) only.
- Provider: Reloadly Airtime Sandbox.
- Payment: explicit mock authorization; Dwolla ACH is not used.
- Recurring recharge: architecture-only and unavailable.
- Production recharge: unavailable and fail-closed.
- `MOBILE_TOPUP_PRODUCTION_ENABLED` and
  `MOBILE_TOPUP_APPROVED_FOR_LIVE_USE` must remain `false`.

The API never marks an order delivered from a client request. `DELIVERED` is
mapped only from a successful provider submission/status response. Unknown
provider states remain pending. The client cannot supply an operator catalog,
denomination, delivery amount or final status.

## Backend configuration

Copy the placeholder names from `.env.example` and configure the TiCash API
process only. Never put Reloadly credentials in Flutter or source control.

```dotenv
MOBILE_TOPUP_ENABLED=true
MOBILE_TOPUP_PAYMENT_MODE=mock
RELOADLY_ENVIRONMENT=sandbox
RELOADLY_CLIENT_ID=your-sandbox-client-id
RELOADLY_CLIENT_SECRET=your-sandbox-client-secret
RELOADLY_AUTH_URL=https://auth.reloadly.com/oauth/token
RELOADLY_AIRTIME_BASE_URL=https://topups-sandbox.reloadly.com
MOBILE_TOPUP_PRODUCTION_ENABLED=false
MOBILE_TOPUP_APPROVED_FOR_LIVE_USE=false
```

The API uses Reloadly's server-side client-credentials token flow. Available
operators, fixed denominations, and data-plan names are read from Reloadly at
runtime. TiCash does not hard-code Digicel or Natcom availability.

After reviewing the schema change in a local Sandbox database, apply it with
`npm run db:push`, then restart the API. Production database changes require a
reviewed migration and rollback plan rather than an ad-hoc schema push.

## API

Authenticated routes are under `/api/mobile-topups`:

- `GET /status`
- `GET /operators?country=HT`
- `GET /operators/detect?phone=+509...`
- `GET /operators/:id/products`
- `GET|POST /recipients`
- `POST /quotes`
- `POST /transactions` with an `Idempotency-Key` header
- `GET /transactions`
- `GET /transactions/:id?refresh=true`
- `POST /transactions/:id/repeat`

The test payment adapter is deliberately separate from remittance funding. A
production card/wallet funding provider and recurring-payment authorization
require a future reviewed implementation.
