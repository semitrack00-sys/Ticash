# Admin business analytics

The TiCash Operations overview and FlupFlap Admin dashboard share a Flutter analytics panel and a read-only database aggregation service. Business records are never consolidated.

## Access and data sources

- `GET /api/admin/analytics`: TiCash staff authentication, `admin.view` and `ledger.view`. Source: `Transfer`, `User` customers and the original `FxQuote` destination.
- `GET /api/admin/flupflap/analytics`: TiCash staff authentication, `recharge.view`, `admin.view` and `recharge.reports`. Source: `MobileTopUpTransaction` with **only** a FlupFlap owner, and `FlupFlapCustomer`. TiCash-owned and dual-owner recharge rows are excluded.
- Ordinary customers, FlupFlap customer tokens and staff without report permission cannot access financial analytics. Existing staff roles and mutations are unchanged.
- No provider API or payment request is made. No schema/migration change is required.
- Database unavailable/query failure returns `503 ANALYTICS_UNAVAILABLE`. The UI shows an unavailable state rather than fake zeroes or memory fixtures.

## Period and accounting definitions

Queries accept `period=today|7d|30d|year|custom`, `mode=live|test` (default live), and for custom periods `start=YYYY-MM-DD&end=YYYY-MM-DD`.

Dates use UTC; the custom end date is inclusive. Requests are bounded to 366 days, clamped to the present, and invalid/reversed/future-only ranges are rejected. Today ends now; 7/30 days include today; This Year starts January 1. Comparisons use the immediately preceding equal-length interval.

Every aggregate is computed in **one SQL statement/database snapshot**. Results cover the entire matching period, not a 100-record transaction page. Charts contain zero-filled daily points; country/operator breakdowns are top 10; recent transactions are latest 10. All totals include all eligible records. Currency sums use database numeric integer cents, returned as strings to preserve precision.

- **Clients:** total/guest/registered accounts as of period end, independent of live/test filter; new accounts created within the period. These are current records, not a historical audit of later account conversions/deletions. Active means a distinct customer with at least one matching transaction, not a login/subscription. Expired guest accounts are still guest records, not expired subscriptions.
- **Sales volume:** completed principal amount, not profit or cash balance. TiCash requires `COMPLETED`; FlupFlap requires `DELIVERED` and payment `CAPTURED`.
- **Fee revenue:** recorded TiCash fee on completed transfers, or fee on completed/captured recharges. Legacy transfers missing `ticashFeeUsd` are excluded from fee attribution and explicitly counted in a warning; total/provider fees are never substituted. This is operational fee revenue, not net profit or a general-ledger accounting report.
- **Timing:** cohort by transaction creation date, evaluated at current status; not settlement-date recognition. Refunds/reversals, failed and pending/recovery rows do not contribute sales/fees. Status cards partition all eligible transactions, including a separate reversed/refunded count.
- **Average:** completed principal divided by completed transaction count, rounded to cents. Success rate is completed divided by all eligible transactions. Empty averages/rates display unavailable, not invented percentages.
- **Currency/environment:** reporting currency is USD. TiCash includes all source currencies using the existing persisted `amountUsd` / `ticashFeeUsd` equivalents created by the transfer engine; analytics performs no fresh FX conversion. TiCash uses stored testMode. FlupFlap requires matching testMode, payment environment and recharge environment, and USD provider amounts; mixed environment and non-USD recharge rows are excluded. Client counts are labeled separately as mode-independent. Test mode values are simulated activity, never live revenue.
- **Performance:** LOW = zero completed volume or more than 20% below the preceding equal-length window; MEDIUM = within ±20%; HIGH = more than 20% above. Nonzero sales without a previous baseline are **not rated**. This is a transparent relative-volume indicator, not a financial forecast or an invented sales target.
- **Country:** TiCash uses the quote's stored receiveCountry; missing historical quote destinations are UNKNOWN, never inferred from a phone or invented. FlupFlap uses the transaction's country.
- **Products:** stored AIRTIME/DATA/BUNDLE categories only. No Internet-plan category is inferred from names. TiCash reports REMITTANCE and stored payout providers.

## Unsupported metrics

Current main has no subscription records or distinct Internet-plan classification. Active/new/cancelled/expired subscriptions and subscription revenue are explicitly **not available**, rather than zero. Internet-plan sales are not split from DATA/BUNDLE without authoritative catalog classification. Implementing subscription sales requires a separately reviewed subscription model, not fabricated dashboard data.

## Tests and previews

Backend tests execute the real aggregation SQL in an embedded PostgreSQL engine (`@electric-sql/pglite`, dev-only), using local test tables and fixtures. They cover record ownership, staff permissions, dates, status partitioning, refunds, environments, cents, missing historical metadata and totals larger than a page.

Flutter tests independently exercise both business panels, periods, errors, permissions and responsive sizes. Fixtures live under `apps/mobile/test/`; no production import references them. Any screenshot harness/build is stored outside the repository and is not a deployment artifact. Preview screenshots use clearly identified test records, never production metrics.
