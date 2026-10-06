# FlupFlap processor cleanup and retained-record expiry
Version 2 — updated 2026-10-06. Status: NONFINANCIAL_PERIODS_APPROVED; expiry enforcement is not implemented.

The owner approved 30 days for raw verification attachments, 90 days for support correspondence and 180 days for ordinary security logs in this conversation on 2026-10-06 at 05:36:54 America/Los_Angeles (12:36:54 UTC). Approval covers these periods and their previously documented clocks; it does not authorize a specific irreversible disposal, financial retention period, provider mutation or production deployment.

Scope: FlupFlap airtime and data-bundle recharge operated by Ticash-App LLC, Nevada, USA. TiCash remittance identities and records are outside this procedure. Support: contact@ticash-app.com.

## Accountability and completion gates
Proposed accountable owner: Dukens Bal. Execution must use a named authorized operator. The three nonfinancial periods are approved; execution role assignment and an exercised disposal mechanism remain required. Review open cases weekly and expiry candidates monthly. These are operating cadences, not installed automations.

Keep separate milestones: REQUEST_VERIFIED → LOCAL_ERASURE_VERIFIED → LEDGER_PUBLISHED → PROCESSOR_REVIEW → RETENTION_REVIEW → COMPLETE_WITH_DISCLOSED_RETENTION. A timeout or provider refusal stays OPEN or BLOCKED; it is never recorded as success. A customer response must distinguish local erasure from provider work still pending.

Before a real case, verify identity and scope using FLUPFLAP_ACCOUNT_DELETION.md. Resolve unsettled payment/refund/dispute work and drain ingress and workers. Existing CLI guards do not stop external operations already in flight.

## Capture the minimum provider inventory before local erasure
The local CLI deletes recurring schedules, including Stripe customer/payment-method bindings. Before it executes, an authorized operator must capture the exact provider object references needed for cleanup in a private case record, with restrictive permissions and access. Never store that inventory in Git, CI output, public tickets or this document.

Use opaque customer UUID, case reference, provider/account/environment, object IDs, reason, reviewed holds and intended action. Match IDs through persisted transaction and recurring bindings. Email or a recipient phone alone is not sufficient proof of ownership; a recharge recipient can be a different person. Stop if an object belongs to another product, a shared customer or a different merchant account. Do not collect passwords, card numbers or CVV.

Immediately after local erasure, export the ledger with the previously trusted signed ledger, publish/read back the new immutable checkpoint, save/verify its independent recovery copy, and advance the trusted checkpoint only after both verifications. Any failure blocks restoration release. Preserve the existing namespace and recovery key; never initialize an empty ledger after a restore.

## Provider-specific execution
| System | Review and action | Required evidence |
| --- | --- | --- |
| Stripe | Verify merchant account, live/test mode, exact customer and each attached payment method; check unsettled charges, refunds, disputes, subscriptions and cross-product use. For an exclusively FlupFlap customer, choose reviewed metadata/contact removal, payment-method detachment or customer deletion only after checking the irreversible consequences. Do not cancel unrelated subscriptions. | Object/account/environment references, action approval, before/after minimal field checks, provider request ID and outcome. No card data or full response payload. |
| Reloadly | Review recharge transaction references and recipient data. Obtain the applicable client agreement/DPA and ask through its authenticated support/privacy route for removal of unnecessary data, retained fields, reason and expiry criterion. Do not delete the merchant account, revoke its credentials or pretend that account-level deletion erases a recipient's transactions. | Provider case ID, written scope/result and any retained category/basis/expiry. Missing confirmation remains pending. |
| Resend or other email/SMS provider | Code supports Resend; confirm the provider actually enabled in the intended deployment without exposing secrets. Review contact/audience entries, suppression lists, message content and delivery logs. Remove unnecessary profile/marketing data through supported controls. Keep only minimal suppression needed to honor opt-out, with its own purpose and review. | Provider inventory, contact/log scope, supported removal result and retention limitations. Disabled integrations record NOT_APPLICABLE with evidence. |
| Support mailbox/ticket system | Remove raw verification attachments after the approved clock expires. Retain only the case reference, verification method, dates, outcome and required retention explanations. Check mailbox trash, exports, forwarded copies and attachments separately. | Exact scope, approved expiry/holds and removal verification. A label or archived message is not deletion. |
| Render and independent copies | Inventory PITR, logical exports, downloads, replicas, external copies and ledger recovery copies. Apply current suppression before releasing any restored copy to users or workers. | Inventory owner, oldest/latest restorable time, actual expiry or confirmed disposal, and restore verification. |

Stripe customer deletion is permanent and cancels active subscriptions. A deleted customer remains retrievable for history; it is not proof that all payment evidence has been erased. Payment-method detachment is irreversible. Sources checked 2026-10-06:
- https://docs.stripe.com/api/customers/delete
- https://docs.stripe.com/api/payment_methods/detach

Reloadly distinguishes client-supplied recipient processing from its own controller activities; use the client DPA and verified case outcome rather than a generic website retention promise:
- https://www.reloadly.com/privacy-policy/
- https://www.reloadly.com/gdpr/

No provider mutation or message is authorized merely by approving this document. Execute real cases only with verified customer scope and the required action approval. This PR makes no provider calls.

## Approved nonfinancial periods and remaining retention review
The 30/90/180-day nonfinancial limits are owner-approved internal policy, not claims that legislation mandates these durations. Financial evidence, suppression receipts and backup rules still require their separate reviews. An unresolved hold must have a specific matter, minimum record scope, named owner and next review date. Re-review monthly; release it promptly when no longer needed.

| Category | Minimum record scope | Approved clock or remaining review rule | Current mechanism / gate |
| --- | --- | --- | --- |
| Account profile, credentials, sessions, saved recipients, recurring bindings | None after verified deletion; opaque tombstone only | Erase during verified fulfillment once payment/worker blockers are resolved | Existing atomic CLI; verify result and authentication rejection |
| Raw identity-verification attachments | Evidence strictly needed to verify the request | 30 days after case closure, unless a specific documented dispute/hold requires longer | Manual mailbox/provider disposal required; not exercised |
| Support correspondence | Minimum request, response and outcome | 90 days after case closure; keep the minimal deletion receipt separately | Manual mailbox/ticket disposal required; not exercised |
| Ordinary security logs | Event/date, limited identifiers needed for incident review | 180 days from event; incident-specific evidence follows its documented hold | Inventory actual destinations and implement expiry before claiming this limit |
| Customer-linked marketing data | No unnecessary profile, visit/event or attribution data | Remove during account deletion; external copies follow documented provider cleanup | Local linked data erased; other stores still require inventory |
| Recharge/payment evidence and promotion accounting | Amount, currency, dates, outcome, payment/provider IDs and only essential reconciliation/dispute fields | Each record gets a reviewed expiry date based on its applicable tax return, dispute/refund, contract and hold requirements; dispose only after every applicable requirement ends | Accountant/owner review required; no blanket duration approved and no automated purge |
| Recipient phone and provider snapshots in financial rows | Only data proven necessary for specific reconciliation/dispute/accounting purpose | Review separately from financial totals; redact unnecessary fields as soon as that purpose ends | Current CLI retains these financial rows; require reviewed schema-specific redaction plan |
| Minimal deletion receipt/audit | Opaque case/customer ID, method/date/operator, outcome/checkpoint; no raw verification attachment | Retain while needed for documented accountability or any restorable copy could recreate erased data; review monthly and record an objective endpoint | Signed ledger and audit exist; no pruning until every dependency is proven expired |
| Backups/exports | Access restricted; suppression enforced on every restore | Expire per verified inventory; seven-day PITR is not a maximum lifetime for all exports/downloads | Verify every copy; do not promise universal seven-day deletion |

For tax-supporting records, IRS guidance uses the applicable return limitation period and exceptions, rather than account-deletion date. Ordinary cases are generally three years; specified circumstances have longer or indefinite requirements. Check non-tax obligations before disposal. This is a review input, not an assertion that every recharge row must be retained for the same period:
https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records

## Monthly expiry operation
1. Build a private candidate list containing category, exact scope, approved policy version, start event, computed expiry, applicable requirements, hold status, storage/provider and executor. Missing clock, duration, obligation review or destination inventory means BLOCKED.
2. Preview read-only counts and dependencies. Distinguish FlupFlap from TiCash and sender from recipient. Avoid broad email/phone matches. Reconcile retained totals and preserve required payment/refund/promotion links.
3. Obtain approval for the exact irreversible scope. Implement a schema-specific transaction/redaction plan after checking foreign keys. No generic cascade, automatic production purge or ledger pruning is supplied here.
4. Exercise that exact plan on synthetic staging records first: expired/unexpired, held/unheld, cross-product controls, shared-provider object and unresolved dispute cases. Verify only approved expired fields change, control accounts and financial totals remain correct, and reruns are safe. Keep production release blocked until evidence exists.
5. Execute the reviewed operation through authorized access; record minimal counts, action IDs, time and failures. Verify primary data and secondary copies separately. Database removal does not prove provider or backup erasure.
6. Update the case with retained categories and next review/expiry; publish customer wording only when it reflects implemented practice. An unknown provider deadline is disclosed as pending, not replaced by an invented date.

## Private case record template
Keep a real populated copy outside this repository.
- Case reference, verified FlupFlap UUID, verification method/date, assigned operator and approver.
- Local audit ID and outcome; prior/new trusted checkpoint and independent readback evidence.
- Per provider: account/environment, object IDs, exclusive/shared ownership, intended action, blockers/holds, approval, provider request/case ID, verified result and residual retention basis/expiry.
- Per retained category: fields, purpose, policy version, start event, duration/objective endpoint, applicable obligations, hold owner/review date, candidate count, executor and disposal verification.
- Customer notice date and accurate remaining work. Do not embed passwords, tokens, card data or full message bodies.

## Readiness evidence
As of 2026-10-06, the provider PITR rehearsal passed for an empty ledger: 20 migrations, 45 tables unchanged after preview/two executions; temporary recovery copy deleted. Prior synthetic logical restore tests exercised nonempty suppression. The physical rehearsal did not test resurrection suppression with real deletion receipts.

The read-only planner described below has synthetic regression coverage. This procedure is not yet approved or exercised against provider systems or actual expiry destinations. Outstanding: execution role assignment; actual provider/destination inventory and capabilities; accountant review of financial obligations; operational expiry/provider cleanup rehearsal; implementation of the approved expiry actions. Restore release remains blocked. Planning tests must not close those gates.

## Read-only retention planner

Build the API, then run from the repository root:

```sh
node apps/api/dist/flupflap/retention-plan-cli.js --input-file /secure/retention-review.json
```

The input must be a regular private file (0600 or stricter), no symlink, at most 1 MiB. The CLI rejects extra arguments, including --execute. It imports no database or provider client. It does not install a timer or grant disposal authority. A successful exit means a valid review plan was produced, not that the records may be erased.

The following empty inventory template records the owner's approved nonfinancial periods. It contains no customer data and is not loaded automatically by production. The same template is saved as flupflap-retention-review-template.json. Populate only opaque references and reviewed attestations in a private working copy; do not copy real customer details into Git. An APPROVED label supplied by an operator is not independent approval verification, so every output still states executionAuthorized=false.

```json
{
  "version": 1,
  "asOf": "2026-10-06T12:36:54Z",
  "policy": {
    "reference": "FLUPFLAP_RETENTION_V1",
    "status": "APPROVED",
    "approvedAt": "2026-10-06T12:36:54Z",
    "durationsDays": {
      "VERIFICATION_ATTACHMENT": 30,
      "SUPPORT_CORRESPONDENCE": 90,
      "SECURITY_LOG": 180
    }
  },
  "records": []
}
```

Supported nonfinancial categories are VERIFICATION_ATTACHMENT, SUPPORT_CORRESPONDENCE and SECURITY_LOG. Security logs use EVENT_OCCURRED; support and verification records use CASE_CLOSED. Days mean elapsed 24-hour periods in UTC, with eligibility for review at the expiry boundary. Future starts, missing clocks/durations and future approval dates block review. Duplicate references and extra input fields reject the entire input.

FINANCIAL_EVIDENCE, DELETION_LEDGER and BACKUP always remain blocked for specialist review. TICASH, unverified inventory, shared/unknown ownership, active/unknown holds and unresolved work are blocked. Expired Stripe, Reloadly and email records require provider review; they never become local disposal candidates. Output hashes input references rather than echoing them, and excludes credentials and customer details. Keep the private reference mapping separately; a hash is not a deletion receipt or anonymization proof.

Only exclusively owned expired LOCAL or SUPPORT nonfinancial records with all supplied gates clear become REVIEW_CANDIDATE. This is a suggestion for the reviewed monthly operation above, not an executable plan or an authorization. Operational ownership, source, holds and approval still need independent verification. Test coverage includes expiry boundaries, timezone offsets, retained records, policy/hold/product/provider guards, private-file restrictions, sanitized errors and rejection of execute mode.

## Storage inventory constraints from the current code

The Prisma schema has no support-ticket or raw-verification-attachment store with a case-closed clock; mailbox/ticket storage must be inventoried separately. AuditLog mixes TiCash and FlupFlap events and deletion receipts, so the approved ordinary-security period does not authorize purging that table by age. RechargeNotification stores recipient phone and delivery evidence linked to financial transactions; it is not an ordinary security log. Provider delivery histories, Render logs, downloaded attachments and forwarded emails require their own inventory and hold checks. These code observations do not verify which external destinations are enabled in production. The planner remains read-only until exact storage scope and disposal procedures have been established and exercised.
