# TiCash Admin & Operations Dashboard

The admin workspace is available at the Flutter route `/admin`. It is intended for TiCash staff operations in the U.S. (USD) to Haiti (HTG) sandbox corridor. It does not enable live money movement.

## Roles and permissions

All authorization is resolved from the backend user record on every request. Client role flags are navigation hints only.

| Role | Intended access |
| --- | --- |
| `SUPER_ADMIN` / legacy `ADMIN` | All staff permissions, including staff role assignment |
| `COMPLIANCE` | Customer review, account restrictions, KYC review workflow, compliance decisions, read-only providers/configuration/ledger/reconciliation/audit |
| `OPERATIONS` | Transfer operations, payout configuration, reconciliation runs, and operational read access |
| `SUPPORT` | Masked customer and transfer lookup only |
| `READ_ONLY` | Read-only operations, providers, configuration, ledger, reconciliation, and audit |

Staff role changes require `staff.manage`, cannot be self-applied, and create an immutable audit event.

## Safety properties

- `APPROVED_FOR_LIVE_USE` remains `false` and cannot be changed from the dashboard.
- MonCash, Natcash, and Haitian bank payout states are backend controlled: `DISABLED`, `SANDBOX`, `PENDING_APPROVAL`, `ACTIVE`, or `SUSPENDED`.
- `ACTIVE` is rejected unless the environment, provider configuration, provider approval, regulatory approval, and corridor live approval are all present. This sandbox build intentionally cannot satisfy that gate.
- Suspending or disabling a payout method removes it from customer choices and blocks payout execution.
- Didit is authoritative when configured. The dashboard does not expose a generic manual “KYC approved” control.
- Ledger entries are read-only. No endpoint exists for editing an entry.
- Reversals use a dedicated, permissioned endpoint, release reserved value through the ledger repository, and write an audit event.
- Fee and transaction-limit changes create immutable configuration versions. Quotes and transfers store the version that supplied their fee/limit configuration.
- Customer email addresses and phone numbers are masked in operational responses. Provider credentials and access tokens are never returned.

## Main API routes

- `GET /api/admin/session`
- `GET /api/admin/overview`
- `GET /api/admin/customers` and `GET /api/admin/customers/:id`
- `PATCH /api/admin/users/:id/restrictions`
- `GET /api/admin/transfers` and `GET /api/admin/transfers/:id`
- `GET /api/admin/reviews`
- `PATCH /api/admin/transfers/:id/compliance`
- `POST /api/admin/transfers/:id/reversal`
- `GET /api/admin/providers`
- `PATCH /api/admin/providers/payouts/:method`
- `GET|POST /api/admin/configuration/fees-limits`
- `GET /api/admin/ledger`
- `GET|POST /api/admin/reconciliation`
- `GET /api/admin/audit`

Database-backed deployments must apply the Prisma schema changes before using the new role, payout configuration, and versioned configuration records. Do not run a destructive schema reset against customer data.

## Provider and regulatory blockers

The dashboard reports Didit, Dwolla, FX, and Haiti payout adapter configuration without exposing secrets. Dwolla, Didit, MonCash, Natcash, Haitian bank payout, or TerraPay production capability must not be inferred from a green sandbox/mock status. Provider contracts, corridor approval, licensing, compliance policy, production credentials, operational procedures, and independent financial/security review remain required before live use.
