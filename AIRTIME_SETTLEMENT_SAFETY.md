# TiCash Airtime Settlement Safety

This document records the TiCash-native settlement invariants for mobile airtime/recharge.

## Why this exists

An airtime request can be accepted by a provider even when TiCash receives a timeout, connection reset, malformed response, or local persistence failure. Those outcomes are not authoritative provider failures. Automatically retrying airtime or refunding payment in those cases can create duplicate airtime or financial loss.

TiCash therefore treats provider uncertainty as a reconciliation state, not as a refund signal.

## Required invariants

1. **Idempotent purchase reservation**
   - A client idempotency key may create at most one recharge transaction.
   - Replays for the same request return the existing transaction.
   - A reused key for different recharge details must be rejected.

2. **Single fulfillment claim**
   - Fulfillment is claimed with a compare-and-set operation before any provider submission.
   - A second request must not submit airtime again while the claim is held or after an uncertain provider result.

3. **Unknown provider outcome preserves payment**
   - Transport failures, 5xx responses, malformed provider responses, and ambiguous timeouts do not prove recharge failure.
   - Such transactions remain `PROCESSING` with `TOPUP_SUBMISSION_UNKNOWN` / `FULFILLMENT_RECONCILIATION_REQUIRED`.
   - TiCash must not automatically void or refund the payment for these outcomes.

4. **Only definite rejection starts recovery**
   - A provider-side rejection that is authoritative and occurs before successful fulfillment may move the recharge to `FAILED`.
   - Payment recovery uses the configured payment provider only.
   - Hosted payments must never fall back to a mock refund.

5. **Known provider success is not converted to failure by local errors**
   - Persistence or audit failures after a provider accepts the recharge must not be caught as a provider rejection.
   - The provider submission and local settlement paths must remain separated.

6. **Provider reversal is not card-refund proof**
   - A recharge provider reporting `REFUNDED` or `REVERSED` is not enough to mark the payment provider refund as complete.
   - Payment status changes to `REFUNDED` only after the payment provider confirms the refund.

7. **Ledger settlement is idempotent**
   - Delivered and refund ledger posting must remain exactly-once.
   - Replay, polling, or duplicate provider/webhook events must not duplicate financial ledger entries.

8. **Environment binding is fail-closed**
   - Payment and recharge environments must match the active runtime.
   - Sandbox and production provider/payment records must never be mixed.

## Current TiCash implementation

The existing TiCash recharge engine already implements these invariants in:

- `apps/api/src/topup/service.ts`
- `apps/api/src/topup/repository.ts`
- `apps/api/src/topup/reloadly-provider.ts`
- `apps/api/src/topup/provider-router.ts`

Existing tests in `apps/api/test/mobile-topup-payments.test.ts`, provider tests, and repository tests cover idempotency, uncertain submission, no resubmission, payment recovery, and compare-and-set claims.

## Reconciliation rule

An unresolved recharge must remain reserved for authoritative reconciliation. Do not invent a provider lookup endpoint. Use only a provider-supported status/lookup API tied to the stable TiCash custom identifier or provider transaction ID.

Until an authoritative status is available:

- do not resubmit airtime;
- do not mark the recharge delivered;
- do not mark the recharge failed;
- do not automatically refund or void captured/authorized funds solely because of an ambiguous submission result.

## Production activation

These safety invariants must stay in place for sandbox and production. Production activation remains gated by provider approval, payment configuration, reconciliation operations, monitoring, regulatory approval, and the existing TiCash live-money controls.
