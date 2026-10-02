# Provider receiving values and receiver notifications

## Quote and delivery contract

The server validates the phone's country, the operator's country, the exact provider
product, fixed denomination or range/increment/precision, and the existing USD
policy **before** requesting a receiving value. No client currency or FX input is
accepted. Existing payment, identity, webhook and provider gates are unchanged.

`receiverQuote` is an immutable snapshot with `amount`, `currency`, `senderAmount`,
`senderCurrency`, `source` and `quotedAt`. The existing `providerAmount` /
`providerCurrency` store the sender's recharge principal; `feeUsd` and
`totalChargeUsd` store the server-calculated fee and payment total. Product snapshot,
product ID, provider reference and quote expiry remain in their existing fields.

Sources:

- Fixed provider products: the provider's delivery value/currency, including Ding
  `ReceiveValue` / `ReceiveCurrencyIso` and DT One currency destination metadata.
- Reloadly: a valid paired fixed catalog value, otherwise its read-only
  `POST /operators/fx-rate` with the validated operator and sender amount.
  Reloadly calls the response field `fxRate`, but it is the receiving value **for
  that requested amount**. It is not multiplied by the amount again.
- No monetary country table, generic FX service or invented denomination is used.
  Missing/mismatched/nonpositive provider receiving values block the quote with
  `RECEIVER_VALUE_UNAVAILABLE` or `INVALID_PROVIDER_RESPONSE`. Products without a
  monetary delivery value cannot be purchased under this contract.

Provider contract references:

- https://www.reloadly.com/blog/how-to-confirm-exchange-rates-when-purchasing-an-international-top-up-with-reloadly/
- https://support.reloadly.com/which-rate-do-you-use-to-convert-money-from-one-currency-to-another
- https://support.reloadly.com/how-can-i-determine-the-operator-minimum-and-maximum-amount-/values

This records provider value at quote time; it does not invent an exchange-rate
lock that the provider has not supplied. If the provider delivers a different
amount/currency, both quote and actual survive and `receiverDiscrepancy` is true.
The first confirmed delivery value is retained on replay. Missing delivery evidence
also flags reconciliation, without refunding a successful recharge. A later
provider reconciliation can supply the missing evidence.

`deliveredValue` / `deliveredCurrency` are used as actual values only after a
successful provider result sets `receiverValueConfirmed`. Historical rows default
to unconfirmed: their existing values remain in the database for audit, but are
not represented as verified delivery or used for SMS. No historical FX is
recalculated or notification backfilled. Customer resume DTOs expose only the
explicit safe receiving fields, not provider IDs or operational metadata.

## Durable outbox and independent sending

The repository writes successful delivery evidence and a `RechargeNotification`
in one database transaction. Its primary key is the recharge transaction ID;
provider/payment event replay cannot create a second initial notification.
PENDING, PROCESSING, UNKNOWN, FAILED and missing-value outcomes create no success
notification. An outbox row contains the actual confirmed value, not the estimate.

`ReceiverNotificationService.processBatch()` is a bounded server-worker entry
point. It has no payment, wallet, Stripe or recharge-provider dependency. It claims
each record with a conditional database update before using `ReceiverSmsProvider`.
The SMS adapter must honor the stable `recharge-receiver:<transactionId>` key.

The production adapter is Telnyx and remains disabled unless all three server-only settings are present: `TELNYX_API_KEY`, `TELNYX_MESSAGING_PROFILE_ID`, and `TELNYX_FROM_NUMBER`. The sender must be E.164 and the messaging profile ID must be a UUID. These values are never exposed to Flutter or API responses.

The API runs a bounded outbox worker only when the database is enabled, Telnyx is fully configured, and the process is not running tests. It claims durable outbox records before making a single `POST https://api.telnyx.com/v2/messages` request. Telnyx SMS sending does not provide server-side idempotency for this endpoint, so the adapter deliberately performs no network retry. A timeout or malformed acceptance response becomes `SMS_OUTCOME_UNKNOWN` and is not automatically resent. An explicit non-2xx rejection becomes `PROVIDER_REJECTED` and remains eligible for a controlled retry. A successful API acceptance is recorded as `SENT`, never fabricated as carrier delivery.

Recharge settlement is independent from SMS. A notification failure cannot change a delivered recharge, payment ledger, provider result, or receiver-value evidence.

Only explicit `NOT_SENT` / `PROVIDER_REJECTED` and `SMS_NOT_CONFIGURED` outcomes are
retryable. An exception, invalid acceptance response or crash after claiming is
an ambiguous outcome: it cannot be automatically resent. SENT and DELIVERED are
never retried. Provider reconciliation is required for ambiguous records. Provider
exceptions/bodies are not persisted; only fixed error categories are retained.

Staff with `recharge.operations` can retry an existing confirmed FlupFlap
transaction via `POST /api/admin/flupflap/transactions/:id/receiver-notification/retry`
with `{}`. The endpoint accepts no phone, message, amount or currency. It uses
existing TiCash staff authentication/RBAC, rejects customer tokens, and cannot
change settlement. Admin transaction views show both amounts, discrepancy and
sanitized SMS status. Customer credentials cannot send arbitrary SMS.

## Languages and clients

Saved-recipient `language` accepts en/ht/es/pt/fr/sw. It takes precedence over an
optional trusted operator `preferredLanguage`, then the extensible country defaults
in `receiver-notification.ts`, then English. KE/TZ default to English unless Swahili
is explicitly preferred; Canada accepts recipient French or English and defaults
to English. The language choice is captured at transaction reservation.

The shared Flutter recharge UI (used by TiCash and FlupFlap) displays receiving
values at review, provider quote timestamp, actual delivery and discrepancy at
receipt, and actual value in history. Existing staff UI displays outbox status and
permission-gated retry. No SMS secret/configuration reaches the clients. The
separate `ticash-app-web` repository is not changed by this backend-repository PR;
its consumer can use the additive `receiverQuote` and actual-value API fields.

## Migration

`202609291800_receiver_value_notifications` adds quote snapshots, confirmation and
discrepancy flags, captured language, optional saved-recipient language, and the
notification outbox with a unique transaction FK. Receiver amounts retain eight
decimal places. Status, currency, positive amount and nonnegative attempt constraints
protect the outbox. There is no backfill that could turn an estimate into a confirmed
delivery. Schema validation/generation and an isolated in-memory PostgreSQL/PGlite
migration/constraint/competing-claim check are safe; no production database is used.

## Validation for this change

- Backend: 625 tests passed, 0 failed (30 files); 38 new cases over the 587-test baseline.
- Typecheck, lint, build, Prisma generation/validation and diff whitespace checks passed.
- TiCash Flutter: analyze passed; 57 tests passed, 0 failed (four new receiver-value tests).
- FlupFlap Flutter: analyze passed; 10 tests passed, 0 failed.
- TiCash release web build passed. Existing secure-storage Wasm dry-run and missing
  Cupertino font warnings remain; the JavaScript web release compiled successfully.
- Isolated PGlite migration check passed: legacy confirmation defaults, no fabricated
  backfill, unique outbox reference, restrictive FK, validation constraints, precision
  preservation and competing notification claims. No production database was used.
- Additional API tampering assertions passed in the 46-case mobile-topup suite.

## Changed-file manifest

- `RECEIVER_VALUE_AND_SMS.md`
- `apps/api/src/flupflap/admin.ts`
- `apps/api/src/topup/provider-router.ts`
- `apps/api/src/topup/receiver-notification.ts`
- `apps/api/src/topup/receiver-value.ts`
- `apps/api/src/topup/reloadly-provider.ts`
- `apps/api/src/topup/repository.ts`
- `apps/api/src/topup/router.ts`
- `apps/api/src/topup/service.ts`
- `apps/api/src/topup/types.ts`
- `apps/api/test/flupflap-identity.test.ts`
- `apps/api/test/mobile-topup-payments.test.ts`
- `apps/api/test/mobile-topup-prisma-repository.test.ts`
- `apps/api/test/mobile-topup.test.ts`
- `apps/api/test/provider-router.test.ts`
- `apps/api/test/receiver-value-notification.test.ts`
- `apps/mobile/lib/models/mobile_top_up.dart`
- `apps/mobile/lib/screens/admin/flupflap_admin_page.dart`
- `apps/mobile/lib/screens/topup/mobile_top_up_screen.dart`
- `apps/mobile/lib/screens/topup/receiver_value_summary.dart`
- `apps/mobile/test/mobile_operator_logo_test.dart`
- `apps/mobile/test/receiver_value_test.dart`
- `migrations/202609291800_receiver_value_notifications/migration.sql`
- `schema.prisma`
