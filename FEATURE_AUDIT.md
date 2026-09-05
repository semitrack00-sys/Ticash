# TiCash feature audit

## Corrected

- Restored a valid npm workspace with an executable TypeScript API and shared types.
- Added registration, login, session restoration, refresh-token rotation, logout,
  recipient create/update/delete management, server-authoritative quotes,
  idempotent transfers, and history.
- Added validation, password hashing, JWT verification, rate limiting, security headers,
  strict body limits, safe public response mapping, and production-secret enforcement.
- Completed the matching Flutter screens and API services with visible errors and
  bounded token refresh.
- Repaired the Prisma schema, Docker build paths, API CI workflow, documentation,
  missing-asset configuration, and transfer-state compatibility.
- Added API integration tests and mobile model coverage.
- Added PostgreSQL persistence for accounts, sessions, recipients, transfers,
  idempotency records, KYC review state, and admin reporting.
- Added editable customer profiles, password rotation with session revocation,
  provider-backed KYC onboarding, and API-enforced KYC transfer gating.
- Restricted launch receiving data and API responses to Haiti (`HT`) and HTG; future
  countries remain architectural extension points, not active destinations.
- Added an opt-in backend-only Dwolla Sandbox funding provider, client-credential token
  lifecycle, masked bank-source persistence, micro-deposit verification operations,
  idempotent ACH requests, verified/idempotent webhook processing, and status mapping.
- Added immutable double-entry USD ledger postings for confirmed ACH settlement and
  reversal, plus a Haiti-only corridor model whose live approvals default to false.
- Added backend-only Didit v3 Sessions API integration, five-minute signed webhook
  verification, event idempotency, conservative status mapping, reconciliation, and the
  official native Flutter SDK boundary without exposing server credentials.

## Persistence and intentionally mock-only money movement

When `DATABASE_URL` is configured, the API persists business records in PostgreSQL.
Automated API tests deliberately use isolated in-memory repositories and a fake Dwolla
provider. Payout adapters remain mock-only. Dwolla is Sandbox-only, disabled by default,
and production-host access is rejected at startup. Didit is disabled by default; tests
use a fake provider and production use still requires an approved workflow, credentials,
privacy/compliance review, and Business Console webhook setup.

The funding layer does not link Dwolla directly to MonCash or NatCash. U.S. ACH funding
and Haiti payout remain separate provider boundaries joined only by future, approved
transfer orchestration and ledger controls.

## External production prerequisites

The following cannot be completed safely from source code alone:

- Dwolla production approval and approved live funding configuration.
- Approved MonCash, NatCash, or Haitian-bank payout contracts and credentials.
- Didit application credentials, a published workflow, a configured public HTTPS webhook
  destination, and an approved KYC/AML policy.
- Explicit approval for each send jurisdiction, funding provider, Haiti payout method,
  currency, and regulatory corridor. USD payout is not active.
- Regulatory/legal approval and a staffed KYC/AML, sanctions, and fraud program.
- Provider-certified webhook behavior, reconciliation, settlement, and exception handling.
- Published fees, terms, privacy, refund/dispute procedures, and customer support operations.
- Production infrastructure, secret management, monitoring, backups, incident response,
  penetration testing, and a controlled pilot.

Until those prerequisites exist, `PAYMENTS_MODE` and `PAYOUTS_MODE` must remain `mock`,
`DWOLLA_ENVIRONMENT` must remain `sandbox`, and all three Dwolla production flags must
remain `false`.
