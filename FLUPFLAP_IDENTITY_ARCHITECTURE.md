# FlupFlap identity separation — audit and additive migration plan

## Checkpoint before implementation

Backend: codex/stripe-config-safe-diagnostics, 5b45265feab222a2757426f4809adf472db7470b.
Website: codex/flupflap-mobile-checkout-ux, a27b607a743e1461f5306fdbd659c5c933dcda61.
Both working trees contain existing work; preserve it. Backend baseline: 405 passed and three 5-second timeouts (guest security, password recovery, login lockout).

## Current identity/ownership map

- User -> Session, PasswordResetToken and LoginSecurityState form TiCash authentication. Access JWT issuer ticash-api/audience ticash-mobile; recharge alone has guest-aware authentication. Guest users are currently User rows with guestExpiresAt.
- User -> MobileTopUpRecipient.userId, MobileTopUpQuote.userId, MobileTopUpTransaction.userId. Recipient uniqueness is user/phone/country. Transaction idempotency is user/key; quoteId is globally unique.
- Quote/transaction immutable snapshots, payment events, provider IDs, operation claims and reconciliation must remain shared.
- Topup service audit callback passes the same owner to AuditLog.userId. This must gain a separate FlupFlap relation instead of creating shadow TiCash users.
- Recharge ledger postings use shared clearing/settlement/revenue accounts and a unique mobile-topup:<transaction>:<event> reference. They do not require a customer User account. Funding wallets, KYC, remittance recipients, transfers and their User relations remain unchanged.
- Historical ownership is available from existing non-null userId foreign keys. No production customer data was queried or copied. Legacy test fixtures and disposable migration data provide validation evidence, not a production inventory.
- apps/mobile is the Flutter TiCash app; its router gates financial entry with TiCash KYC. Keep it intact. Its MobileTopUpService/provider can be injected into a separate FlupFlap entry point without cloning the recharge engine.
- TiCash Operations is apps/mobile/lib/screens/admin/admin_screen.dart; authorization is apps/api/src/admin-access.ts. Add explicitly scoped recharge permissions; never treat FlupFlap customers as staff.

## Additive ownership plan

Create FlupFlapCustomer, FlupFlapSession and FlupFlapPasswordResetToken. Registration needs email/password only, with optional billing country collected when needed. Guest rows have expiration and no invented email. No remittance/KYC/funding relations.

Add nullable flupFlapCustomerId to the three recharge tables; make legacy userId nullable. SQL CHECK requires exactly one owner. Existing rows retain userId unchanged and gain a null FlupFlap owner. Preserve legacy indexes and add FlupFlap-specific recipient/idempotency indexes and foreign keys. Add an optional FlupFlap audit actor relation; no ledger rewrite.

The single recharge engine keeps its current owner argument. A server-generated domain-qualified owner (flupflap:<UUID>) is translated at repository/audit boundaries to the explicit FlupFlap foreign key. It is not a TiCash User ID and is never accepted from request bodies. Legacy owner IDs retain their existing mapping. This avoids a second provider/payment/recharge engine while making data ownership explicit.

FlupFlap JWT issuer/audience, session store, reset tokens and authentication routes are separate. TiCash middleware continues accepting only its original issuer/audience. Mount the existing recharge router under /api/flupflap/mobile-topups with the FlupFlap context. Preserve /api/mobile-topups for TiCash. Payment webhooks continue using globally unique transaction IDs and the shared repository.

## Migration verification before editing Prisma

Generate the current schema as SQL without contacting a configured database. Apply that baseline and the candidate additive SQL only to a dedicated disposable loopback PostgreSQL cluster under the workspace artifacts directory. Seed synthetic legacy ownership. Verify preservation, both-owner/no-owner rejection, foreign keys, separate uniqueness, and customer-domain separation. Do not touch configured application databases, .env, db push or production migration commands.

## Safety

New domain defaults disabled until configuration and migration are intentionally applied. No live gates change. No provider purchase, real payment, deployment, commit or push is authorized. Reset delivery, package identity, signing and production rollout require explicit configuration; no legal exemption is assumed.

## Implemented boundaries

- Three new persistent Prisma models; exactly-one-owner constraints on recipients, quotes and transactions; FlupFlap audit actor; auth version binds sessions and invalidates reset/login races.
- Legacy TiCash User, KYC, funding, remittance, session and reset behavior remains intact. No automatic linking by matching email. Existing User-owned history stays available through TiCash's legacy recharge endpoint.
- FlupFlap auth uses its own issuer/audience/HS256 secret and session/reset tables. Disabled by default; production configuration requires a database and a distinct signing secret. Safety checks reject live/production gates. Registration accepts email/password and optional billing country only. No role/owner/status from a customer body is trusted.
- Public FlupFlap web entry points now use this namespace. TiCash-mode API clients retain their previous routes/contract. A legacy TiCash account does not automatically sign into FlupFlap or migrate its history; the customer must explicitly create a separate FlupFlap identity.
- `/api/flupflap/mobile-topups` and legacy `/api/mobile-topups` share the same service instance. Existing provider routing, immutable snapshots, verified webhooks, operation claims and ledger references remain single implementations.
- App: `apps/flupflap`, `com.ticash.flupflap`; separate storage/client/navigation/entry, reuses shared recharge presentation. See its README for build/configuration limitations.

## Operations admin

The existing TiCash Operations workspace has a FlupFlap section: Dashboard, Transactions, Customers, Countries, Operators, Products, Providers, Pending/Failures, Refunds, Financials, Reports, Settings and Audit. Backend routes are `/api/admin/flupflap/*` and require TiCash staff credentials and explicit recharge permissions. Customer lists query only FlupFlapCustomer. Transaction views query only FlupFlap-owned records. Pagination is explicit; financial rows are page-scoped, never represented as lifetime revenue.

Operations staff may restrict recharge and refresh provider-confirmed status through the shared engine. Provider/settings writes fail closed with `REVIEWED_CONFIGURATION_REQUIRED`. Manual refunds fail closed with `PROVIDER_CONFIRMED_REFUND_WORKFLOW_REQUIRED`; the module does not invent refund execution or override financial state. Refund views show the engine's recorded refund/recovery states. Production configuration, any future refund workflow and live activation remain separately approved work.

## Disposable migration verification

Migration: `migrations/202609271200_flupflap_identity/migration.sql`. It checks the reserved principal namespace first, then adds new tables/relations/indexes and XOR ownership checks. Existing records are not rewritten. The prior uncommitted product-snapshot migration remains separate and must be included in eventual migration sequencing.

`tools/check-flupflap-migration.mjs <pre-change-baseline.sql>` uses only a dedicated loopback PostgreSQL cluster at port 55439 with role flupflap_test and creates a uniquely named disposable database. It requires compiled API output (`npm run build`). The baseline is the pre-FlupFlap schema captured before Prisma edits. Tests cover legacy preservation, invalid/mixed owners, independent identities, persistence/reload, scoped recipients/history/idempotency, concurrent reservation, shared ledger idempotency, session rotation and single-use reset. No configured application database is contacted.
