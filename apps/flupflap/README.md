# FlupFlap Android customer target

This is a separate application, not a renamed TiCash APK. Package/application ID: `com.ticash.flupflap`. Display name: FlupFlap. Entry: `lib/main.dart`. It uses its own Dio instance, FlupFlap-only API routes and secure-storage refresh key. Access tokens remain in memory. TiCash `ApiClient`, auth notifier and KYC routes are not used by this entry point.

Shared recharge UI/models/services come from `../mobile` as a path dependency. Provider/catalog/payment logic remains in the one backend topup engine. The dependency currently brings transitive native plugins from TiCash, including Didit; no KYC screen or customer access is exposed. Extracting shared Flutter presentation into a smaller package can reduce APK size in a later focused change.

## Build (Flutter 3.47.1 / Dart 3.13.1)

From this directory:

```powershell
flutter pub get --offline
flutter analyze
flutter test
flutter build apk --debug --dart-define=FLUPFLAP_API_BASE_URL=https://YOUR-APPROVED-SANDBOX-HOST/api
```

Do not use the illustrative host literally. The endpoint is public configuration, not a key. No API URL is bundled by default: an unconfigured build displays a configuration message and performs no requests. Only HTTPS is accepted. Backend `FLUPFLAP_ENABLED` defaults false and needs reviewed database migration/configuration before a device can authenticate. No test catalog or localhost fallback is included in production code.

Output: `build/app/outputs/flutter-apk/app-debug.apk`. Release signing requires this target's own ignored `android/key.properties` and keystore; release does not fall back to debug signing. TiCash's application ID and build/signing configuration remain unchanged.

## Identity / recovery

- Auth: `/api/flupflap/auth/*`; recharge: `/api/flupflap/mobile-topups/*`.
- Navigation: Home, Recharge, History, Recipients, Account.
- Lightweight email/password signup; sandbox-only restricted guest entry.
- Deep-link namespace: `flupflap://recharge` and `flupflap://reset-password?token=…`.
- Password recovery requires a separately configured HTTPS FlupFlap landing page. Production verified Android app links and ownership verification require approved domain/signing configuration before release. Custom-scheme links alone are not verified app links.
- Tokens are not shared with TiCash. Logout clears local credentials even when the server is unreachable; in-flight refresh cannot restore a signed-out session.
- Checkout uses server-created hosted Stripe Checkout when the backend reports complete STRIPE_SANDBOX or STRIPE_LIVE availability. Only explicit safe MOCK mode uses the existing purchase route. No card fields or provider credentials enter Flutter. See WEB_PARITY.md for return handoff and validation.

All verification uses test doubles or disposable local data. No real payment/provider transaction is needed to validate this target.

## Premium UI regression validation

`test/flupflap_test.dart` retains the original identity, guest, signup, navigation,
logout/refresh race and endpoint isolation contracts. `test/premium_ui_test.dart`
adds mocked end-to-end recipient/recharge/review/result flows, all five transaction
states, retry, keyboard submission, password recovery and permanent/guest profile
boundaries. Its catalog, amounts and phone numbers are test fixtures only.

The responsive matrix covers 360, 375, 390, 412, 430 and 768 logical pixels at
1.0 and 1.5 text scale, including registration with a 300-pixel keyboard inset.
Optional local screenshots can be captured by setting `FLUPFLAP_SCREENSHOT_DIR`
to an artifact directory outside source and `FLUPFLAP_TEST_FONT` to the SDK's
`bin/cache/artifacts/material_fonts/roboto-regular.ttf` before running the premium
tests. These variables affect test rendering only; no fixtures enter an APK.

Run both packages after changes to the shared recharge screen:

```sh
# apps/flupflap
flutter pub get
flutter analyze
flutter test
# apps/mobile
flutter pub get
flutter analyze
flutter test
```

FlupFlap uses its own step controller with shared recharge models/client. Provider routing remains backend-controlled; the app does not override it. Saved-recipient navigation supplies only the existing recipient metadata;
operator detection and quote creation still use the backend. History opens stored
receipts and Repeat requests a fresh quote without automatically purchasing.

The existing Android workflow builds debug APK and AAB artifacts after validation.
These are QA artifacts, not store releases. Validate `flutter build apk --release`
and `flutter build appbundle --release` only with separately provisioned release
signing. Never disable the signing guard or commit a keystore/key.properties.
