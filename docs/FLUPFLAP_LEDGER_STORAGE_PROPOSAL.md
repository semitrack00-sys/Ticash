# Proposed independent ledger storage on Render

The owner has no existing S3 or Google Cloud Storage bucket. The attached proposed Blueprint creates a separate paid background worker with a 1 GB persistent disk in the existing Render workspace. It does not alter the customer API or any database. Do not apply this proposal before approval of its new recurring charge.

Pricing checked against https://render.com/pricing on 2026-10-06 UTC: the 512 MB / 0.5 CPU service is USD 7/month and persistent disk storage is USD 0.25/GB/month. Estimated incremental baseline: USD 7.25/month, excluding taxes and any applicable usage overages. No workspace upgrade is included or authorized by this proposal. Recheck the Dashboard estimate before creation.

The worker has no public HTTP endpoint, no database credentials and no production signing secret. Automatic deployments are off. Access to its disk is through authorized Render shell/SSH access; review existing workspace membership and restrict operators before storing real ledger entries. Files under /var/data/flupflap-ledger persist across worker deployments/restarts. Existing API services retain their deployment and scaling behavior.

After provisioning, verify persistence with a non-sensitive disposable file across a worker restart. Then establish the signing key, environment namespace and latest independent checkpoint record before exporting real deletion entries. Transfer only the signed opaque ledger through an approved private operator process. Verify the saved bytes and checkpoint; do not leave the only ledger copy on an ephemeral API filesystem.

Keep the trusted current checkpoint outside disk snapshots, such as a restricted current-release operations record. A valid older disk snapshot can contain an older signed ledger; restoring that disk must never also reset the trusted current checkpoint unnoticed. Maintain an additional controlled recovery copy and document key recovery. Do not claim the proposal alone supplies immutable storage or protection against compromise of the entire Render workspace.

This first provisioning step provides durable storage only. It does not implement an upload endpoint, an automated export pipeline, a physical database recovery drill, processor cleanup or retention expiry. Do not release restored accounts or mark the full deletion rollout complete until those procedures are implemented and exercised. The signing-key and ledger workflows are documented in FLUPFLAP_RESTORE_LEDGER.md.

Render disks are accessible by one service instance at runtime; attaching one to the customer API would prevent horizontal scaling and zero-downtime deployments. Isolating the disk on this storage worker avoids those changes to the customer API. Render automatically snapshots disks, but snapshot age is not proof that every independent export has expired.
