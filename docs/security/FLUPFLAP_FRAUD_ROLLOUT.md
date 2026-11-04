# FlupFlap fraud protection review — draft, November 3, 2026

Nothing in this draft activates Radar rules. Do not merge or deploy until tests are complete and the owner explicitly approves. Baseline: `8d5511b94c37eabb8efa55118b4bc5db1214bafb`.

## Existing protections verified in source

- Hosted Checkout requires billing address. The server sets the amount and transaction binding; clients cannot submit card details or choose a payment status. FlupFlap uses automatic 3DS and still respects issuer-required authentication.
- Before live Stripe airtime fulfillment, the backend retrieves the succeeded/captured charge, checks transaction binding and live mode, and requires normal risk, passing ZIP/CVC, acceptable authentication, and no review/dispute/refund. Unknown evidence holds the order.
- Paid suspicious orders remain PENDING/CAPTURED with FRAUD_REVIEW_REQUIRED. They are not refunded merely by being held. Reconciliation and retries do not automatically release them. Staff release requires fresh evidence; unsafe card checks/risk cannot be overridden.
- Frequency limits: three reservations/hour, ten/day; monetary limits already $100/order and $200/rolling day. Failed/hidden reservations count. Recipient budgets and customer locks limit races across accounts/workers.
- Three signed failed attempts in 15 minutes trigger a temporary cooldown; failed and paid card fingerprints plus device associations detect card switching. Failures are deduplicated by Stripe attempt. Expiry information is returned to customers.
- Shared cards/recipients, restricted linked accounts and card switching can hold fulfillment. Fingerprints are hashed. Device identifiers are signals, not reliable identity proof.
- Email trim/lowercase normalization plus database uniqueness prevent duplicate email accounts. This does not prove one human per account or prevent aliases/different emails.
- Authentication, staff permissions, webhook verification, idempotency and domain/owner isolation already exist.

## Changes in this draft

1. Admin/Super Admin-only `recharge.payments.cancel` permission and cancellation API/button. A reason and explicit confirmation are required. Only FlupFlap PENDING/SESSION_CREATED Stripe checkouts with no payment authorization/fulfillment/recovery evidence qualify.
2. Read the original session, verify transaction metadata/reference, exact amount/currency/mode and unpaid/no-intent state, expire if open, reread closed state, then conditionally update the unchanged local record. Missing/foreign-account sessions are never assumed unpaid. History is retained. Audit records identify the requesting administrator and completion. No refund/paid-order override.
3. Server-owned `business=flupflap` and `fraudPolicyVersion=2026-11-03` metadata on Checkout and its PaymentIntent, including recurring intents. Neither metadata nor policies manufacture a customer IP or CVC result.
4. Draft Radar manifest: `flupflap-radar-draft.json`. Three policy groups use four rules: block nonpassing/missing ZIP/CVC; block missing/mismatched IP/card country; block highest risk and review elevated risk. No uploader or runtime activation code exists.
5. Regression tests for authorization, Stripe binding/errors, closed sessions, concurrent local changes, issuer checks, risk holds and scope metadata. Admin UI tests cover confirmation, success, failure, and read-only roles.

## Radar readiness and remaining gaps

All conditions are prepared for Dashboard validation, NOT certified or activated. The backend already holds ZIP/CVC and risk failures; that is a delivery hold after collection, not proof Radar blocked the charge. Stripe's IP-country Radar attribute is not exposed by the existing charge evidence reader. Do not substitute the billing country, recipient country, client-supplied fields or arbitrary forwarded headers. Country enforcement depends on the verified Dashboard rule and must be tested there before rollout.

Rules target new payments with the server-owned label. Existing open checkouts and older recurring intents lack the label; inventory and resolve those separately. Do not enable the scoped rules before approved backend deployment. Existing global rules/allowlists may alter outcomes. Review their precedence and scope in the actual account `acct_1TTY71FEcUl5NAXm` (FlupFlap Express and Sales). Dashboard subscription/permissions for custom rules and review must be confirmed. Do not change the old Ticash-app account's rules.

Strict policies can reject legitimate travelers, VPN users, cross-border cardholders, wallets, off-session recurring charges, and cards/regions without supported postal-code verification. No country allowlist is introduced. Worldwide availability is NOT guaranteed under strict missing-data blocking. The owner must approve observed false positives and any proposed exceptions; this draft silently creates none. Existing guest accounts can reach Checkout but the live fraud gate holds guests (`ACCOUNT_REVIEW_REQUIRED`); that existing behavior needs an explicit product decision before claiming guest purchases work worldwide.

## Validation and release gates

Local (UTC): full API suite passed, 1,191 tests across 60 files; 13 real-PostgreSQL tests in one file skipped because no FRAUD_TEST_DATABASE_URL was configured. TypeScript build, API lint and whitespace checks passed. The earlier focused runs passed 192 payment/cancellation/access tests and 125 fraud/identity/purchase tests. The first embedded-database test run failed because the host timezone shifted timestamp decoding; rerunning in UTC passed all seven affected tests. No production database was used. Flutter is not installed locally, so admin UI analysis/tests/build require GitHub CI. Run full API CI and real PostgreSQL concurrency tests. Record final CI results in the PR; failed checks block approval.

Dashboard/sandbox tests still required, one policy at a time:

| Scenario | Expected result |
| --- | --- |
| Matching US/US, FR/FR, HT/HT with normal risk and both checks pass | No match to these custom rules; normal issuer/other checks still apply |
| ZIP or CVC missing, unavailable, unchecked or fail | Block; no supplier request |
| IP/card countries missing or different | Block; no supplier request |
| Highest risk | Block |
| Elevated risk | Review; backend holds any captured payment; no supplier request |
| Normal risk but open review or failed evidence lookup | Backend holds |
| Retried webhook/reconciliation of held order | Still held; no duplicate delivery |
| Wallet, off-session recurring, traveler and no-AVS issuer | Measure false positives; no bypass without approval |
| Unrelated subscription without FlupFlap label | No match to these new scoped custom rules |
| Paid/delivered payment or missing old-account checkout cancellation | Refuse cancellation, retain state |

Use Stripe's documented test cards in a sandbox/test account, never real charges to test declines. Dashboard rule preview/backtesting against relevant FlupFlap traffic is read-only evidence, not equivalent to a successful end-to-end sandbox test. Confirm the webhook destination, signing secret, events, retry handling and fulfillment evidence. A captured held order needs a separately authorized review/refund process. The older pending checkout still needs original-account access; this feature does not remove that requirement.

## Rollback procedure

Before approval, close the draft PR; production is unchanged. After a separately approved deployment:

1. Record deployed backend/admin SHAs and all Radar rule IDs, conditions, actions, prior states and activation times. Stop new checkout creation using the existing reviewed operational controls if payment safety is uncertain. Do not automatically release held orders.
2. If Radar creates unexpected declines, disable ONLY newly activated rule IDs, restoring their prior state. Preserve unrelated existing rules and the backend fraud hold. This requires an authorized Dashboard operator.
3. Revert this PR's merge commit through a reviewed revert PR and redeploy the prior backend/admin artifacts (baseline above, or the recorded immediate predecessor). No schema migration is introduced; no database rollback is required. Remove/revert the admin UI together with the API; a cached UI calling a missing endpoint must fail without assuming success.
4. Do not resurrect expired checkouts or reset FAILED/CAPTURED records. Keep all audit/history rows. Existing cancellations remain cancelled. Paid holds require fresh Stripe verification and authorized handling.
5. Verify normal payment status reads, webhook processing and hold behavior after rollback. Existing scoped Radar rules must not be left active while new payments stop carrying the label: restore the recorded rule configuration deliberately and verify coverage.

References: https://docs.stripe.com/radar/rules/reference , https://docs.stripe.com/radar/testing , https://docs.stripe.com/testing , https://docs.stripe.com/radar/transaction-risk-prevention .
