# FlupFlap in-app account deletion

The registered-customer Account screen now accepts a deletion request directly,
without opening email. The customer supplies their FlupFlap password and explicitly
confirms permanent deletion. Guests retain the external support path for an account
they cannot currently access. The public website's existing external request path
remains available without reinstalling the app.

`POST /api/flupflap/auth/account-deletion` accepts only `password` and
`confirm: DELETE_ACCOUNT`. Authentication determines the target identity. The API
verifies the password, locks the current customer, and rechecks the password hash,
auth version and ACTIVE status before accepting. No customer ID is accepted from
the request body. Passwords are not recorded in audit metadata or queue rows.

Acceptance persists an opaque request, sets DELETION_PENDING, increments auth
version, removes sessions/reset tokens, cancels recurring schedules and clears
checkout resume capabilities. Existing in-flight worker claims are preserved until
they drain. SQL insert and recurring-claim guards serialize with the customer lock
and reject new work for a deleting identity. ACTIVE-only authentication rejects old
access, refresh and reset credentials.

The server attempts eligible local-data erasure immediately and retries persistent
pending requests every minute, including after restart. Unsettled payment/recharge
records, recovery work or active claims defer erasure. New requests are not starved
behind waiting requests. A stuck/ambiguous payment or abandoned external claim
requires operations reconciliation; the worker does not assume it is safe to erase
or invent a successful refund. Watch PENDING requests with PENDING_PAYMENTS or
IN_FLIGHT_WORK and resolve their underlying operational condition.

Once work drains, profile/contact/credential data, saved recipients, recurring
payment bindings, unused nonfinancial quotes and linked marketing data are erased
atomically using the existing erasure primitive. A deletion receipt and queue
completion commit together. Required transaction, security and promotion accounting
evidence remains. The API reports LOCAL_DATA_DELETED only for that local operation;
it does not promise that provider or backup copies have disappeared.

Apply migration `202610130100_flupflap_self_service_deletion` before starting the
new API. No new service, credentials or environment variable is required. The
existing FLUPFLAP_ACCOUNT_DELETION.md procedure still governs external support
requests, processor cleanup, retention and independent restore suppression.
Export receipts with the existing signed deletion ledger before a restore, apply
suppression before reopening restored access, and reconcile provider records using
their authorized operations process. Never treat temporary access revocation alone
as completed deletion. Only authorized test accounts should be used for rehearsals.

Validation includes migrated PostgreSQL tests for password/confirmation checks,
identity isolation, immediate revocation, recurring cancellation, in-flight claims,
pending payment retry, irreversible state, SQL stale-insert/claim guards, preserved
financial records and idempotent completion; Flutter tests cover confirmation,
server errors, session clearing and account-switch races.
