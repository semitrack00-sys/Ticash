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
- The reused mobile checkout uses the existing MOCK purchase route. It does not collect card details or implement a native Stripe payment UI. Stripe sandbox remains supported by the existing website/shared backend. Native Stripe UI is a separate capability, not silently enabled here.

All verification uses test doubles or disposable local data. No real payment/provider transaction is needed to validate this target.
