# FlupFlap Play release preparation

FlupFlap's permanent Android application ID is `com.ticash.flupflap`.
The app now targets Android 16 (API 36). Google requires API 36 for new phone
apps and updates from August 31, 2026:
https://support.google.com/googleplay/android-developer/answer/11926878

The regular Android workflow continues to produce **debug QA builds**. Its
offline native startup capture also runs on API 36 alongside API 30 and 31.
A separate release-mode CI check uses a disposable two-day certificate and an
invalid API hostname to exercise optimized APK/AAB builds without production
signing credentials. It uploads only validation reports. Both the CI check and
production workflow verify 64-bit ELF alignment, APK ZIP alignment and the AAB
signature. Static alignment checks do not replace testing on a 16 KB device.
Those captures test launch behavior; they are not a complete Android 16 review.
Test back navigation, keyboard/insets, checkout return, recovery links and
large-screen layout on Android 16 before distributing a release.

## Signed release workflow

The manually dispatched `FlupFlap signed release bundle` workflow runs only
on `main`, uses the `flupflap-release` GitHub environment and does not publish
to Google Play or execute a payment. Configure that environment's branch
restrictions and reviewers to match the repository's release process.

Provision these four environment secrets privately:

- `FLUPFLAP_UPLOAD_KEYSTORE_BASE64`: base64-encoded FlupFlap upload keystore
- `FLUPFLAP_UPLOAD_KEY_ALIAS`: the private upload key alias
- `FLUPFLAP_UPLOAD_KEY_PASSWORD`: private key password
- `FLUPFLAP_UPLOAD_STORE_PASSWORD`: keystore password

Use the existing FlupFlap upload identity if one has already been registered.
Do not use TiCash's key or create a replacement identity for an existing app.
For a new Play app, choose and securely back up the upload identity before the
first upload. This change neither generates a production key nor provisions
secrets. Never commit a keystore or `key.properties`, and do not send passwords
in chat. Android's release-signing guard remains enabled.

Dispatch with a reviewed production HTTPS API URL ending in `/api`, a version
name such as `0.1.0`, and a version code higher than every code already uploaded
to any Play track. The workflow cannot check Play Console's version-code history.
Build 5 is an existing QA build; it does not establish the next Play version code.

The signing helper rejects missing or invalid credentials and Android debug
certificates. It writes ignored signing files with private permissions, handles
Java property escaping and refuses to overwrite local signing files. The
workflow removes those files even on failure. It runs analysis/tests and builds
with `--release`, verifies the AAB's JAR signature, then retains only the bundle,
checksum and public build provenance for 14 days. Self-signed upload certificates
are normal; signature verification is not proof of Play acceptance.

Download the artifact and upload to an internal test track first. Verify Play App
Signing setup, merged permissions, native library/16 KB support, target API and
reviewer access. The transitive TiCash native plugins must be audited too; app
screens alone do not establish the final permissions or Data safety answers.

## Other blockers from source review

- D-U-N-S organization verification is pending.
- The Account screen now provides Privacy policy and Delete my account, with a
  fixed email composer, copyable support address and public deletion resource.
  The composer never sends automatically. The companion website change must be
  deployed and independently checked: the public deletion URL returned 404 on
  2026-10-06 before this fix. Receipt removal is not account deletion.
- Backend fulfillment from merged PR #122 remains an operator-controlled process;
  provider cleanup, retention review and restore gates are separate. Do not imply
  that following a link automatically erases all records.
- Camera, microphone and vibration permissions from shared native dependencies
  are removed for this recharge app. CI inspects the built APK manifest and
  rejects their reintroduction. Retest the signed release and review actual SDK
  activity before completing Data safety; SDK presence is not proof of collection.
- Store screenshots must show the reviewed release. Native login/splash captures
  and mocked UI test fixtures do not establish working purchases.
- Production customer/recharge and hosted Stripe Checkout availability, service
  markets, refunds and support need release validation without unapproved real
  financial transactions.

Google's account-deletion requirements:
https://support.google.com/googleplay/android-developer/answer/13327111

Local signing-helper checks (requires Java/keytool, no production secrets):

```sh
cd apps/flupflap
python3 -m unittest discover -s tool -p 'test_release_signing.py'
```

These checks create short-lived disposable certificates in temporary directories.
