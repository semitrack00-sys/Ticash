# Automatic security refunds (disabled by default)

The existing live fraud gate stops supplier delivery but can leave a captured payment held. This change refunds the full order total, including the fee, only when fresh Stripe evidence confirms highest risk, an explicit failed CVC/postal/street check, or failed authentication. It does not turn missing checks, elevated risk, network errors, account/velocity holds, disputes, existing refunds, or unknown evidence into automatic money movements.

`FLUPFLAP_AUTO_SECURITY_REFUNDS_ENABLED=true` enables the new behavior. Leave it unset until Stripe sandbox scenarios and production activation approval are complete. No schema migration is required. This flag is not enabled by this PR.

## Safety and execution

- Only live FlupFlap Stripe orders that are pending, captured and fraud-held qualify. The existing gate creates the hold before refund evaluation. Existing held orders are evaluated on authorized operational refresh or repeated fulfillment processing; this is not a bulk historical-refund job.
- Re-read Stripe evidence and the PaymentIntent. Require succeeded/live, exact transaction metadata, USD, full amount and amount received. Never infer capture from a timeout or stale local state.
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

Regression tests cover partial/mismatched refunds, pending/failed responses, manual full refunds, lost-response read recovery, and signed Checkout replay through the service and database. The latter use simulated Stripe responses and do not replace sandbox webhook delivery testing. The current automatic-refund orchestration explicitly excludes sandbox orders; a separate isolated integration-test setup remains a release blocker. Do not bypass production environment checks to simulate completion.

## Rollback

Unset or set `FLUPFLAP_AUTO_SECURITY_REFUNDS_ENABLED=false` to stop new automatic refund decisions, then deploy the previous backend if needed. Keep recovery reconciliation running for already claimed REFUND_PENDING orders. Preserve audits, ledger/history and refunds: a completed Stripe refund cannot be undone by reverting code. Do not reset refunded or recovery-pending orders to fulfillable state. No custom Radar or payment-method setting is changed by this PR.
