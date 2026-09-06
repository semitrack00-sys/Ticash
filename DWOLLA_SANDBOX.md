# Dwolla Sandbox funding foundation

## Scope and safety boundary

Dwolla is an optional backend-only U.S. ACH funding provider. It is not a Haiti
payout provider and is never called by Flutter. This implementation is UAT-only:

- `DWOLLA_ENABLED` defaults to `false`.
- `DWOLLA_ENVIRONMENT` defaults to `sandbox`.
- all production approval flags default to `false`.
- the API rejects `DWOLLA_ENVIRONMENT=production`, even if all flags are changed.
- no ledger credit occurs from a mobile/browser claim.

The initial receiving market remains Haiti (`HT`) and the visible receiving
currency remains Haitian gourde (`HTG`). A future USD payout must have an approved
provider and explicit corridor authorization before it can be returned by the API.

## Existing system audit

Before this work, the API had JWT authentication, rotating refresh sessions,
manual backend KYC review, Haiti-only recipient validation, server-calculated
USD-to-HTG quotes, idempotent mock payout requests, and a Prisma model. It did not
have a funding-provider interface, Dwolla client, funding-source records, provider
webhooks, corridor configuration, or a relational double-entry ledger. Didit was
not connected; the existing KYC state was a manual test workflow.

## Funding lifecycle

1. An authenticated, backend-KYC-approved user creates or reuses a Dwolla
   unverified-customer record. TiCash KYC remains an independent backend gate; final
   Dwolla customer/funds-flow configuration still requires Dwolla review before launch.
2. Bank details are sent directly from the API process to Dwolla. TiCash persists
   only the provider resource identifier, display name, account type, and last four.
3. The API initiates and verifies micro-deposits using the Dwolla funding-source
   resource. The client cannot set a source to verified. Provider-side verification
   events are verified and synchronized, and three failed attempts lock verification.
4. A verified source can be selected as the account default. Removal uses Dwolla's
   soft-removal API and is rejected while a TiCash ACH request is pending.
5. An ACH request reserves a unique `(userId, idempotencyKey)` record before the
   provider call and forwards an `Idempotency-Key` to Dwolla.
6. The request stays pending/processing until an authenticated provider status
   fetch or verified webhook confirms the authoritative state.
7. A first confirmed `processed` state creates one balanced ledger transaction:
   debit `DWOLLA_CLEARING_USD`, credit `USER_WALLET_USD:<userId>`.
8. Dwolla reports an ACH return as a `failed` transfer. If the transfer had
   already settled, TiCash records the internal state as `REVERSED` and creates
   one inverse ledger transaction. Unique references prevent duplicate settlement
   or reversal entries.

## Provider state mapping

| Dwolla | TiCash |
| --- | --- |
| `pending` | `PROCESSING` |
| `processed` | `COMPLETED` |
| `failed` before settlement | `FAILED` |
| `failed` after settlement | `REVERSED` |
| `cancelled` | `CANCELLED` |

Unknown provider statuses fail closed and do not post to the ledger.

## Webhook controls

The webhook route receives the exact raw JSON bytes and verifies
`X-Request-Signature-SHA-256` with an HMAC-SHA256 computed from the configured
webhook secret. Only the event ID, topic, payload hash, processing status, and
sanitized error code are stored. Event IDs and ledger references are unique.
Transfer events trigger a server-to-server read of the linked Dwolla resource;
the event body itself is not trusted as payment status. Account, Customer, and
Customer-bank transfer topic prefixes are supported. A failed processing attempt
may be retried with the identical event payload, while reuse of an event ID with
a different payload is rejected.

## Required local Sandbox configuration

Use the placeholders documented in `.env.example`. Required values when enabled:

- `DWOLLA_CLIENT_ID`
- `DWOLLA_CLIENT_SECRET`
- `DWOLLA_WEBHOOK_SECRET`
- `DWOLLA_MASTER_FUNDING_SOURCE_URL`

Keep `PAYMENTS_MODE=mock`, `PAYOUTS_MODE=mock`, and every production flag false.
Apply the reviewed Prisma schema with `npm run db:push`, then seed disabled
Haiti corridor candidates with `npm run db:seed`.

The mobile Bank Accounts screen calls the backend only. It does not persist full bank
numbers locally, and API responses contain only provider references, last four digits,
bank/account display metadata, verification state, timestamps, and default status.
Memory-mode storage is suitable only for automated tests and disposable demos; restart
recovery testing requires PostgreSQL via `DATABASE_URL`.

## Production blockers

- Dwolla production approval and final account/customer model review.
- Didit or another approved KYC provider, verified webhooks, and compliance policy.
- AML/sanctions/fraud screening, transaction limits, and operational case handling.
- Approved MonCash, NatCash, or Haitian-bank payout integration.
- Explicit funding, payout, currency, jurisdiction, and regulatory corridor approval.
- Settlement reconciliation, disputes/returns operations, monitoring, and incident response.

Official implementation references:

- <https://developers.dwolla.com/docs/connect/api-reference/authorization/application-authorization>
- <https://developers.dwolla.com/docs/connect/api-reference/api-fundamentals/making-requests-and-authentication>
- <https://developers.dwolla.com/docs/api-reference/customers/create-a-customer>
- <https://developers.dwolla.com/docs/api-reference/funding-sources/create-customer-funding-source>
- <https://developers.dwolla.com/docs/micro-deposit-verification>
- <https://developers.dwolla.com/docs/api-reference/transfers/initiate-a-transfer>
- <https://developers.dwolla.com/docs/transfer-failures>
- <https://developers.dwolla.com/docs/api-reference/events>
- <https://developers.dwolla.com/docs/connect/working-with-webhooks>
