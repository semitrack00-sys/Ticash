# FlupFlap support deletion procedure

Current processor inventory, proposed expiry schedule and completion gates: [FLUPFLAP_PROCESSOR_RETENTION.md](FLUPFLAP_PROCESSOR_RETENTION.md). Capture exact provider bindings privately before local erasure removes recurring schedules. The owner approved the 30/90/180-day nonfinancial periods on 2026-10-06; an exercised expiry mechanism and category-specific financial/backup review are still required.

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

The tool does not contact Stripe, Reloadly, an email/SMS provider or backup storage. Review provider records and saved payment methods separately; remove unnecessary customer metadata/consents when supported, retaining required payment evidence. Add the customer UUID to the restore-suppression procedure so backup restoration cannot recreate erased profile data. Keep request files and support tickets under the approved support retention schedule. The contact@ticash-app.com inbox receipt test passed on 2026-10-06 UTC. A staged restore drill remains a launch requirement.


## Render staging rehearsal

Status updated on 2026-10-06 UTC: a PostgreSQL database rehearsal passed in a deliberately rolled-back transaction; the committed operational CLI, HTTP login test, provider cleanup and restore drill remain outstanding. The connected Render tools cannot change a service branch or execute this CLI. The staging database rejects external connections; do not broaden its network allowlist just to run this test.

Use [ticash-api-staging-v2](https://dashboard.render.com/web/srv-daup1bp7lnhs739d6110) with branch `codex/flupflap-deletion-fulfillment`. Record the deployed commit and successful pre-deploy migration. Do not merge to `main` to obtain a staging deployment: production also automatically deploys `main`.

Before any mutation, inspect the staging service's DATABASE_URL privately in Render and confirm it binds to `ticash-db-staging` (`dpg-dauotjojo6nc73e13v00-a`), not `ticash-db` (`dpg-dao5s7142hec738ilpng-a`). Do not copy the URL into a ticket or chat. Confirm payment and recharge integrations use test credentials or a mock adapter and cannot create a real charge or recharge. A service's staging name does not prove either condition.

1. Create a disposable registered FlupFlap customer through staging. Use a controlled test email and a separate authorized test administrator. Record only UUIDs in the rehearsal record.
2. Add a saved recipient and login session. Exercise recurring recharge only with provider test bindings and a settled test transaction. Keep an unrelated control customer. Capture counts and transaction totals before deletion.
3. Complete identity verification. Generate the private request JSON described above, preview it, and record counts. Wrong verified email or a non-admin staff identity must reject the preview.
4. Stop all ingress and any external schedules, consumers or staff actions writing to this database, then drain in-flight work. Render maintenance mode alone does not demonstrate that background or external work has stopped. Execute only when this drain is established.
5. Run the CLI from an authorized private staging execution environment with its existing staging database binding. Record the opaque request reference and audit UUID. No customer credentials or request JSON belong in build logs.
6. Confirm deleted status, null profile/credentials, no sessions/reset tokens/recipients/recurring schedules, disabled referral code, removed marketing attribution and unchanged retained financial totals. Confirm the control customer is unchanged.
7. Resume staging and verify old login, access token, refresh token and reset token fail. An old token must not retrieve account history or authorize new work. Verify recurring processing cannot schedule another occurrence for the deleted customer. A second CLI execution must return ALREADY_DELETED.
8. Review test provider records and run a restore drill in a separate isolated database. Apply deletion suppression before restoring service access; the restored customer must remain erased.
9. Record pass/fail for each item, deployed commit, migration, timestamps and operator. Restore the service's original branch/configuration as appropriate. Reverting code does not undo a deletion or remove the applied migration.

The migrated PGlite integration suite already covers erasure, retained transactions, identity/role restrictions, blocked pending work, invalidated credentials, SQL guards, isolation and atomic rollback. Those results do not substitute for the Render deployment, provider review or restore drill.

## Retention decisions before public policy publication

This table documents current deletion behavior and outstanding decisions. It is not an approved retention schedule. No automatic expiry of retained financial, audit, support or backup records is implemented by this PR.

| Category | Behavior when verified deletion executes | Decision still required |
| --- | --- | --- |
| Profile, credentials, sessions, saved recipients, recurring payment bindings | Erased in the atomic deletion operation | Support response and fulfillment deadline; verify staffing can meet it |
| Customer marketing attribution and linked visit/events | Removed; referral code disabled | Retention for other marketing records outside this relationship |
| Recharge/payment transactions, required quotes, payment events, promotion accounting | Retained for reconciliation, disputes and accounting | Exact minimum fields, applicable obligations, period, start event and expiry mechanism |
| Security/audit records and deletion receipt | Retained with an opaque customer UUID | Defined security/compliance purpose, period and restricted access |
| Support emails and identity-verification evidence | Outside the CLI | Mailbox/ticket expiry and minimum verification evidence |
| Stripe/recharge/email/SMS provider records | Outside the CLI | Each processor's deletion capability, required retention and completion evidence |
| Backups and restore suppression | Outside the CLI | Actual backup expiry, who controls it and suppression retention long enough to cover every restorable copy |

For each retained category, record the owner, purpose, fields, retention clock, duration or objective expiry criterion, legal-hold exception and deletion procedure. Restrict legal holds to records actually needed for the matter; review holds periodically. Do not use a blanket financial-record exception to retain erased account profiles.

The owner confirmed on 2026-10-06 that FlupFlap provides recharge only. The owner confirmed the company is registered in Nevada, USA on 2026-10-06 UTC. This policy covers FlupFlap recharge; do not assume TiCash money-transmission obligations apply to FlupFlap. For U.S. tax records, [IRS guidance](https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records) uses different periods depending on the record and circumstances; it does not establish a universal seven-year rule for all customer data. If California privacy law applies, [the current CPPA materials](https://cppa.ca.gov/regulations/) require a separate applicability and minimization review; being in California alone does not establish that every business is covered.

Publish per-category retention wording only after these decisions are confirmed and the corresponding operational expiry exists. The public privacy page must describe actual practice. Do not promise a numeric backup or provider deadline that has not been verified.


### Rehearsal evidence — 2026-10-06 UTC

- Render service: ticash-api-staging-v2, deployed commit `562e5f598395cc544f6196f11e814076c1d24caa`, deployment `dep-db282fp7lnhs73dvl230` reached live.
- Confirmed database hostname matches the separate staging instance and does not match production. Payment mode was mock and recharge environment sandbox.
- Render pre-deploy successfully applied `202610060400_flupflap_account_deletion` to `ticash_db_staging`.
- Created disposable staff, customer, control customer, session, reset token, recipient, settled synthetic transaction and recurring schedule within one serializable transaction. No provider calls or real payments were made.
- Exercised preview, wrong verified email rejection, erasure, auth-version increment, session/reset removal, recipient/schedule removal, financial preservation, control-account isolation, audit receipt and ALREADY_DELETED behavior. All assertions passed.
- Deliberately rolled back the outer transaction. Follow-up queries confirmed staff, customer/control and audit rows did not persist.
- This rehearsal wrapped the deletion function in the outer test transaction. It does not validate a normal committed CLI run, request verification, drained maintenance, public HTTP login behavior, concurrent worker execution, processor cleanup or backup restoration.
- Original service branch `main` was restored after the rehearsal. The additive staging migration remains applied; no production deployment or PR merge occurred.


## Nevada / USA retention basis and proposed operating rules

Scope confirmed by the owner: Ticash-App LLC, Nevada, United States; FlupFlap provides mobile recharge only. The registration state does not determine all customer-location, provider-contract or tax obligations. Treat money-transmission records in the separate TiCash service separately.

[NRS 603A.200](https://www.leg.state.nv.us/nrs/nrs-603a.html#NRS603ASec200) requires reasonable destruction measures when a business stops maintaining personal records. NRS 603A.210 addresses reasonable security for covered Nevada-resident records. These provisions do not supply a universal customer-data retention duration.

For records supporting U.S. tax returns, apply the relevant tax limitation period and documented exceptions rather than a blanket duration for every customer field. [IRS guidance](https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records) generally describes three years in ordinary cases, six years for certain substantial income omissions, seven for specified bad-debt/worthless-security claims and indefinite retention for unfiled or fraudulent returns. The retention clock depends on the return and circumstances; account deletion does not start that clock. Check other actual contractual/legal requirements before releasing financial evidence.

Proposed operating rules to finalize before launch:

- Erase ordinary account profile and access data when verified deletion executes, after pending payment work is reconciled. Do not defer profile erasure merely because transaction evidence remains.
- Retain only transaction fields needed to evidence recharge, payment/refund, accounting or a specific dispute. Current retained transactions and required quotes can include recipient phone numbers. Record this explicitly in the customer response; the current CLI does not anonymize those financial rows.
- Determine financial-record release from the applicable tax period, actual provider/insurance obligations and closure of documented disputes or legal holds. Give each hold an owner, scope and review date. A hold must not authorize reuse for marketing.
- Limit support verification evidence to what establishes the request. Define a separate support-ticket expiry before promising a duration; the Gmail inbox does not automatically implement this policy.
- Keep an opaque deletion receipt/suppression identifier only for the documented audit or restore-suppression purpose. Determine the audit expiry separately from credentials and profile data.
- Obtain processor cleanup evidence separately. Do not promise that Stripe, recharge providers or email/SMS services erase every record immediately.

### Backup inventory checked

On 2026-10-06 UTC, the production Render database recovery page for `ticash-db` reported point-in-time recovery for the past seven days. It also states that logical export files are retained for **at least** seven days; this is not a maximum export lifetime.

This observation covers Render's recovery feature only. Inventory downloads, independent exports, replicas, support attachments and processor copies before stating full backup expiry. Restored data must have the deletion suppression applied before customer access or worker execution resumes. The current PR does not implement a durable suppression ledger independent of a restored database, so the restore drill remains a release requirement.

### Public wording

The website draft separates account/profile erasure, retained recharge/payment evidence, security/support records and backup/processor copies. It uses objective retention criteria until category-specific periods and expiry procedures are established. Do not publish a numeric whole-account erasure guarantee based solely on the seven-day Render recovery window.


## Full-workflow preflight — 2026-10-06 UTC

The staging service's database binding was rechecked and matches `ticash-db-staging`. An aggregate query found **zero unlocked ADMIN/SUPER_ADMIN users**. The committed CLI rehearsal is blocked until an authorized staging-only operator identity exists.

Prepared test scope:

1. Establish a temporary operator in staging only, with no production role or credentials. Record its UUID. Disable the identity after testing; audit foreign keys can require retaining the disabled operator row.
2. Create disposable recharge customer/control fixtures with unique reserved test-domain addresses. Keep tokens/passwords in a permission-restricted temporary test file or process memory, never logs. Do not send test email or call payment/recharge providers.
3. Stop staging API ingress and background workers, not just the edge maintenance page. The API contains recurring, SMS and reconciliation timers. Record what was stopped and drained before setting maintenanceConfirmed.
4. Preview and execute the ordinary CLI against the disposable customer, with real persistent staging PostgreSQL transactions. Validate the CLI audit UUID and counts.
5. Resume staging and test old password login, access token, refresh token and reset token through HTTP. Confirm the unrelated control customer remains usable and no recurring schedule can run.
6. Verify the final identity is a DELETED tombstone and the expected financial test evidence remains. Disable the test operator and remove transient credential/request files under the test cleanup procedure.

### Restore release procedure to implement and rehearse

An audit row in the same database is insufficient as the only deletion suppression source: a backup from before deletion will not contain it.

- Maintain a restricted durable deletion ledger outside the restorable database. Store only customer UUID, deletion time, audit/request reference and the minimum evidence needed to reapply erasure. Do not include erased profile data or credentials. Protect ledger access and preserve it until every affected restorable copy has expired.
- Before restoring service access, load every deletion entry newer than the restore point and apply idempotent suppression. Invalidate sessions/reset tokens and recurring bindings; remove profile/recipient/marketing data, while preserving legitimately retained financial evidence.
- Fail the restore release if the independent ledger is missing, incomplete, unreadable or suppression verification fails. Keep API ingress and all workers stopped until the release succeeds.
- Test with an isolated copy of disposable data captured before deletion. After restoring that copy and applying suppression, verify old login/tokens fail and no recurring schedule survives.
- A physical Render recovery drill may create another billed database. Select the target and cost before provisioning; never restore over production.

### Retained-record expiry procedure to finalize

Review retained categories monthly and after resolving a dispute. For each proposed disposal, record the data category, period/start event, tax or contractual basis, holds checked, scope, executor and verification result. Separate financial recipient phone numbers from ordinary saved-recipient/profile data. Resolve foreign-key dependencies before deleting financial evidence.

Support tickets, raw verification evidence, security logs and provider records need their own documented expiry; the financial-record tax period must not automatically be applied to them. This PR does not yet automate those expiry operations or provide an independent restore ledger. Do not mark the retention rollout complete until the procedures have an assigned operator and have been exercised.
