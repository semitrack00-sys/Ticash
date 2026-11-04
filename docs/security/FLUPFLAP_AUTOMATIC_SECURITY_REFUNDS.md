# Automatic security refunds (disabled by default)

The existing live fraud gate stops supplier delivery but can leave a captured payment held. This change refunds the full order total, including the fee, only when fresh Stripe evidence confirms highest risk, an explicit failed CVC/postal/street check, or failed authentication. It does not turn missing checks, elevated risk, network errors, account/velocity holds, disputes, existing refunds, or unknown evidence into automatic money movements.

`FLUPFLAP_AUTO_SECURITY_REFUNDS_ENABLED=true` enables the new behavior. Leave it unset until Stripe sandbox scenarios and production activation approval are complete. No schema migration is required. The same flag may be enabled in an isolated sandbox runtime for validation; never point that runtime at the production database. This flag is not enabled by this PR.

## Safety and execution

- Only FlupFlap Stripe orders in the active runtime that are pending, captured and fraud-held qualify. The existing gate creates the hold before refund evaluation. Existing held orders are evaluated on authorized operational refresh or repeated fulfillment processing; this is not a bulk historical-refund job.
- Re-read Stripe evidence and the PaymentIntent. Require succeeded with livemode matching the order and runtime, exact transaction metadata, USD, full amount and amount received. Never infer capture from a timeout or stale local state.
- Audit the request before claiming. Atomically compare the order timestamp, payment reference, hold and captured state. Require no supplier transaction, operator transaction, delivery timestamp, fulfillment claim or prior recovery claim.
- The winning claim sets FAILED/REFUND_PENDING and excludes delivery. Fulfillment claims also reject holds and recovery claims. Only the winner calls Stripe, using the existing transaction-specific refund idempotency key.
- Confirmed refunds become REFUNDED. Timeouts and pending replies stay REFUND_PENDING for the existing recovery reconciler. A crash after the claim is recoverable. Customer status reads cannot initiate refunds.
- The current implementation still uses automatic capture in Checkout. It does not activate Radar rules or promise rejection before charging. Radar rollout remains separate.

## Validation and release gates

Tests cover confirmed and uncertain evidence, mismatched amount/currency/environment/transaction, rollout disabled, duplicate workers, delivery winning the claim, audit failure, lost refund response and read-only customer refresh. The real PostgreSQL suite exercises independent-connection refund claims and delivery exclusion.

Before activation, validate Stripe sandbox refund success, pending and lost-response recovery, repeated signed events, and a successful legitimate purchase. Review the eligible existing holds and monitor refund errors. Do not use live customer payments as test fixtures. Confirm country/issuer false positives separately before enabling custom Radar policies.

## Additional validation and recovery correction

Sandbox provider smoke testing on 2026-11-03 (America/Los_Angeles) confirmed a $1 test card payment, a full successful refund, and rejection of a second full refund. This was an isolated Stripe Checkout/connector test, not a deployed FlupFlap end-to-end test. No live funds or supplier delivery were involved.

Recovery confirmation now requires the correct PaymentIntent, USD currency, full exact amount, succeeded status, and no conflicting transaction metadata. A matching transaction ID on a partial refund is insufficient. Full manual refunds without transaction metadata can still be recognized. Split partial refunds remain pending for operational review rather than being guessed complete.

Regression tests cover partial/mismatched refunds, pending/failed responses, manual full refunds, lost-response read recovery, and signed Checkout replay through the service and database. The latter use simulated Stripe responses and do not replace sandbox webhook delivery testing. Sandbox orchestration is available only when the same opt-in flag is enabled in a sandbox runtime. Order payment/recharge environments, testMode, Stripe livemode, and atomic-claim environment snapshots must match. Production environment checks remain enforced.

## Rollback

Unset or set `FLUPFLAP_AUTO_SECURITY_REFUNDS_ENABLED=false` to stop new automatic refund decisions, then deploy the previous backend if needed. Keep recovery reconciliation running for already claimed REFUND_PENDING orders. Preserve audits, ledger/history and refunds: a completed Stripe refund cannot be undone by reverting code. Do not reset refunded or recovery-pending orders to fulfillable state. No custom Radar or payment-method setting is changed by this PR.

## Application-to-sandbox recovery validation

The manual harness `apps/api/test/manual-sandbox-refund.ts` runs the real service, fraud gate, Stripe response parsing and Prisma repository against disposable PGlite. A connector driver services its requests only against the specified Stripe sandbox; the harness has no API keys or production database. Set `SANDBOX_REFUND_BRIDGE_DIR` to an isolated scratch directory containing `fixture.json` (livemode false, test Checkout ID, PaymentIntent ID, matching transaction UUID, optional loseRefundResponse). Run with `TZ=UTC node --import tsx apps/api/test/manual-sandbox-refund.ts`; service request-N.json with sandbox connector calls and write the actual JSON response-N.json. Never use live credentials or live payments. The harness forbids supplier delivery and checks a single refund POST.

Executed against sandbox payment pi_3UXuifFbN6NmwRkM0fIt8JrR, captured for $5 with a failed postal check. The service requested refund re_3UXuifFbN6NmwRkM0z5JX6nr, which Stripe confirmed succeeded. The harness then deliberately discarded that response: the database stayed REFUND_PENDING, and a customer-safe read reconciled to REFUNDED from Stripe. Exactly one POST and zero supplier calls; repeat fulfillment did not refund again. Production mode was never enabled.

Limitations: connector mediation does not forward the application's Idempotency-Key header, so provider-side idempotency replay is covered by local request tests, not this remote run. Signed event verification/replay is locally tested; deployed webhook delivery and legitimate supplier delivery remain unverified. Custom Radar rules still require Dashboard testing and explicit activation approval.
