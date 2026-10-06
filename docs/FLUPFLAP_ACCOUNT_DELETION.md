# FlupFlap support deletion procedure

Requests arrive at contact@ticash-app.com. This is a manual staff process. The public page and app open an email request; neither submits or completes deletion automatically.

## Verify and prepare

1. Record an opaque ticket reference. Confirm control of the registered email with a reply challenge or an authenticated customer request. A matching From header alone is insufficient. For lost email access, escalate to the owner; do not guess identity, accept screenshots alone, or ask for passwords/card details.
2. Match the verified email to the exact FlupFlap customer UUID. TiCash User identities are separate and must not be deleted by this tool. An unlocked ADMIN or SUPER_ADMIN must perform the operation with authorized database access. This tool is not an HTTP endpoint.
3. Explain which transaction, security/audit and promotion accounting records remain, why they are needed and the applicable retention period. The owner must approve a retention schedule before launch. No arbitrary legal duration is supplied by this implementation.
4. Reconcile pending purchases/refunds first. For execution, stop API ingress and all recharge, recurring, notification and marketing workers; wait for in-flight requests to drain. Check there are no active worker claims. Do not falsely set `maintenanceConfirmed`. Database insert guards are additional protection, not a replacement for stopping external payment calls already in progress.
5. Apply reviewed migrations and build the API before running the tool. Test the entire procedure on a disposable staging account first.

## Preview, then execute

Create a permission-restricted JSON file outside the repository:

```json
{
  "customerId": "customer-uuid",
  "staffId": "admin-user-uuid",
  "verifiedEmail": "verified-customer@example.com",
  "requestReference": "DELETE_2026_0001",
  "verificationMethod": "REGISTERED_EMAIL_CONTROL",
  "maintenanceConfirmed": false
}
```

Use real UUIDs. Run with the intended database URL supplied securely in the environment:

```sh
node apps/api/dist/flupflap/account-deletion-cli.js --request-file /secure/request.json
```

Preview makes no changes. Confirm the UUID, request reference, expected counts and retained transaction count. During the drained maintenance window, set `maintenanceConfirmed` to true and run:

```sh
node apps/api/dist/flupflap/account-deletion-cli.js --request-file /secure/request.json --execute
```

Execution removes profile names, email, phone, country, Google identity, password, verification data, login/reset sessions, saved recipients, recurring schedules with saved payment bindings, unused nonfinancial quotes, and the customer's marketing attribution/visit/events. It disables their referral code, scrubs a linked promoter's name, removes checkout resume capabilities and marks the identity permanently DELETED. A UUID tombstone preserves transaction/accounting references. Financial transactions and their required quotes, payment events, security/audit records and promotion accounting remain. Unused promotional quotes retain accounting references but have recipient phone/snapshots scrubbed and are expired.

Any unresolved transaction, recurring worker claim, mismatched identity, invalid staff role or missing maintenance acknowledgement blocks execution. All erasure and the audit receipt commit in one transaction; failures roll back. Repeated execution reports ALREADY_DELETED; inspect the existing audit receipt rather than recreating the account. Retried serializable conflicts require a fresh preview. CLI output omits customer email and credentials.

## Complete the support ticket

Record the audit UUID. Verify login/refresh/reset no longer work, saved recipients and recurring schedules are gone, and retained transactions still reconcile. Resume the services. Send the customer a completion response identifying retained categories, purpose and retention period. Do not claim full erasure while third-party or backup work is outstanding.

The tool does not contact Stripe, Reloadly, an email/SMS provider or backup storage. Review provider records and saved payment methods separately; remove unnecessary customer metadata/consents when supported, retaining required payment evidence. Add the customer UUID to the restore-suppression procedure so backup restoration cannot recreate erased profile data. Keep request files and support tickets under the approved support retention schedule. A staged restore drill and an actual inbox receipt test remain launch requirements.
