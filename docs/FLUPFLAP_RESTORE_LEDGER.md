# FlupFlap restore suppression ledger

This is operator-only tooling. It has no HTTP endpoint, makes no provider calls and does not provision durable storage. It is not a complete production backup system. Do not use it to release a restored environment until an independent durable ledger and checkpoint store have been selected, secured and verified.

## Trust and storage

Use a dedicated random signing secret of at least 32 bytes in FLUPFLAP_LEDGER_SIGNING_KEY and a stable environment UUID in FLUPFLAP_LEDGER_NAMESPACE. Keep the secret in a restricted secret store, separately from database backups. Do not reuse customer JWT, Stripe or database secrets. Do not include secrets in a repository, shell history, tickets or logs.

The signed ledger contains only customer UUID, original deletion audit UUID and deletion time, plus version, environment namespace and export time. It does not contain erased email addresses, profile fields, passwords or tokens. Treat these opaque identifiers as restricted operational data.

Store the ledger outside the database being restored. Also store its SHA-256 checkpoint in a trusted, separately maintained current-release record. The restore tool requires the expected current checkpoint; a valid signature alone would accept an older, incomplete signed ledger. Do not calculate the expected checkpoint from the candidate restore file and call that a freshness check.

The tool cannot prove completeness of operator-supplied data. The current checkpoint must be updated only after the entire newest ledger is durably stored and checked. Missing or unavailable ledger, signing key or current checkpoint means no restore release.

Initialize once from the authoritative database with all known deletion receipts, after checking historical completeness:

```sh
node apps/api/dist/flupflap/deletion-ledger-cli.js initialize --output /secure/new-ledger.json
```

For later exports, supply the previous independently held ledger and its trusted checkpoint in FLUPFLAP_LEDGER_CHECKPOINT:

```sh
node apps/api/dist/flupflap/deletion-ledger-cli.js export --output /secure/new-ledger.json --prior /secure/previous-ledger.json
```

Exports merge previous entries with current deletion receipts. This prevents a restored database lacking older receipts from dropping those deletions during subsequent exports. The output path must be new; the CLI refuses to overwrite an existing ledger. Files are created with mode 0600. CLI output gives entry count and checkpoint and explicitly reports durableStorageConfirmed=false. A runtime temporary file is not durable independent storage.

After each verified deletion, keep the maintenance window open until the merged ledger is durably saved and the trusted checkpoint updated. If export or durable write fails, keep the deletion's opaque receipt in the controlled operations record and keep restoration blocked until the complete ledger is recovered. Do not declare the backup portion of fulfillment complete merely because the database transaction committed.

## Restore procedure

1. Restore into an isolated target. Stop customer ingress, all recharge/SMS/reconciliation/marketing workers and external writers before loading any backup rows. Finish the full restore before applying suppression. Verify the target environment, namespace, signing key and latest independent checkpoint. Apply the deletion migration and build the reviewed code first.
2. Use an authorized unlocked administrator in the restored target. The original deletion operator need not exist in that backup. Never grant production access merely to rehearse this process.
3. Create a permission-restricted request file with staffId, namespace, expectedCheckpoint and maintenanceConfirmed. Use true only after the target is drained. These values are operator-supplied evidence, not automatic proof that workers are stopped.
4. Preview, inspect counts, then execute:

```sh
node apps/api/dist/flupflap/deletion-ledger-cli.js restore --ledger /secure/current-ledger.json --request-file /secure/restore-request.json
node apps/api/dist/flupflap/deletion-ledger-cli.js restore --ledger /secure/current-ledger.json --request-file /secure/restore-request.json --execute
```

Signature, namespace, current checkpoint and administrator validation happen before mutation. Each identity is suppressed in an atomic serializable transaction. A failure later in the ledger can leave earlier identities suppressed; it must prevent release of the entire restored environment. Rerunning the same complete ledger is idempotent. The CLI reports failure with a sanitized code, never a success after partial failure.

Suppression erases restored profile/access data, saved recipients, recurring bindings and marketing attribution using the same erasure primitive as ordinary deletion. It does not call payment/recharge providers. Historical pending payment rows remain financial evidence with account checkout capabilities removed; reconcile them separately while workers remain stopped. Do not replay an old restored payment job or schedule.

Already-deleted accounts are scrubbed again without incrementing their auth version repeatedly or duplicating restore audit receipts. Identities absent from a fully restored backup are counted as absent. This does not authorize later imports to recreate them: run suppression again after any additional import before releasing access.

Verify old access/refresh/reset credentials fail, no saved recipient or recurring schedule survives and legitimately retained financial totals remain. Validate unrelated control accounts. Review every failure and reconcile provider state before restarting services. Carry the independent ledger forward using export with --prior; do not reinitialize from a restored database that lacks original receipts.

## Validation and remaining rollout work

The migrated PostgreSQL integration suite restores only synthetic pre-deletion rows into a separate PGlite database. It demonstrates that an older backup lacking the deletion receipt becomes suppressed using the independently held signed ledger, authentication tokens stop working, recurrence is removed, financial evidence remains and reruns are idempotent. It also rejects tampered files, wrong namespaces, insufficient keys and stale checkpoints.

This logical fixture drill does not replace a Render physical recovery drill, independent durable storage setup, key recovery/rotation planning, public ingress verification, processor cleanup or retained-record expiry procedures. No production ledger, signing secret or deployment is created by these code changes. Keep the release blocked until those operational requirements are satisfied.

