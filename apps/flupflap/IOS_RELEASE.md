# FlupFlap iOS release

The checked-in runner comes from Flutter 3.47.1 (6655482ec06e547f90abf8ae7590466f4415978d).
Its upstream license is retained in `ios/FLUTTER_TEMPLATE_LICENSE`.
Use CocoaPods (`flutter config --no-enable-swift-package-manager`). iOS 15 or later is required.

## Apple registration

- App Store Connect: FlupFlap Recharge, Apple ID `6826289851`.
- Bundle ID: `com.ticash.flupflap`.
- Current team: `7P2QSN66T7` (Dukens Bal). The requested TiCash-App LLC migration is not confirmed complete.
- Distribution profile: `FlupFlap Recharge App Store`, created October 23, 2026.
- App Store version draft: `1.0.4`. The first review build can use build number `10`; check uploaded build numbers before a signed upload.

The current CI workflow builds simulator and unsigned device release apps and runs native
checkout/privacy boundary tests. **Its artifacts cannot be uploaded to TestFlight.**
The original complete Flutter regression suite remains in Bundle UI review.

## Native behavior

The iOS customer-actions channel implements the same checkout, sharing and privacy actions
as Android. Checkout opens only validated HTTPS Stripe Checkout URLs. The `flupflap` URL
scheme routes checkout return, referral and password-reset links through the existing Dart router.
The existing backend mobile return target already produces that scheme; no provider or fee
contract is changed. Payment state still comes from the backend, never from URL parameters.

Secure storage uses the app's own default keychain access group. No shared app group,
Apple Pay entitlement, push service or new customer-data permission is enabled.

## Before signing and submitting

1. Obtain explicit approval before giving a build runner access to the distribution key.
   Keep the password-protected PKCS#12, its password and provisioning profile in an approved
   encrypted release secret store. Never commit them or include them in build artifacts/logs.
2. Import signing material into an ephemeral macOS keychain, install the verified profile,
   set manual distribution signing for this bundle ID/team, and export an App Store Connect IPA.
   Remove the keychain/profile and temporary private files even when a build fails.
3. Inspect the final IPA entitlements, bundle ID, version, certificate/profile match and production
   API configuration. Use the App Store Connect upload workflow approved by the account holder.
4. Complete TestFlight checks on an iPhone: guest and account login, secure token persistence,
   Airtime/Bundles quotes, checkout/browser return, failure/cancel recovery, SMS/WhatsApp/share
   availability and account-deletion links. Use controlled test payments; do not spend real funds
   without a separate authorized transaction.
5. Audit the bundled SDKs and App Privacy answers. The shared TiCash package currently brings
   the Didit native dependency even though FlupFlap does not invoke identity capture. Resolve
   unused SDK packaging or any App Store validation warnings before submission; do not declare
   camera/microphone collection merely because the SDK is transitively linked.
6. Capture actual iPhone/iPad store screenshots and complete age rating, content rights,
   review access, export compliance and EU trader information using verified facts.

The Apple account currently has an active Free Apps Agreement. Do not accept new legal
agreements or publish trader contact details without the required account-holder confirmation.
