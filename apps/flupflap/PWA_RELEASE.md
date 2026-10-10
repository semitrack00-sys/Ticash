# FlupFlap PWA release

The PWA compiles `lib/main.dart`, the same Flutter entry point as the APK and AAB. Home, Recharge, History, Recipients, Account, guest/signup/login, backend-priced airtime/data bundles, polling, pending-payment locks and the five language catalogs share the existing implementation. Android MethodChannel actions and secure token storage remain the default native behavior.

## Browser adaptations

- Browser actions use validated hosted Stripe Checkout, browser sharing/copy fallback and the existing privacy/deletion links.
- Authentication tokens remain in memory. Browser startup can restore through the existing backend HttpOnly-cookie refresh endpoint, with credentialed requests only to the configured API. Third-party-cookie restrictions can require another sign-in; never introduce localStorage token persistence to work around them.
- The explicit FlupFlap-only `FLUPFLAP_PWA` return target goes to `https://www.flupflap.com/app/#/checkout-return?...`. The one-transaction capability is in the fragment, removed by routing, and used only for the existing read-only resume endpoint. Existing Android and website returns are unchanged. Deploy the API support before opening PWA payments publicly.
- The PWA scope is `/app/`; installing it does not replace the existing website. Public compiled assets are precached. All APIs, mutations, provider requests and credential/query URLs bypass the worker cache. No offline recharge, queued payment or locally calculated price exists.
- Worker updates wait for old tabs to close. No forced reload or skipWaiting interrupts Checkout.
- Icons are derived from the official logo; dedicated maskable icons keep the mark in the safe area.

## Build and verification

Flutter 3.47.1, Python 3 and Pillow 11.3.0:

```sh
flutter pub get
flutter analyze
flutter test
node --test tool/pwa.test.mjs
bash tool/build_pwa.sh
# Install Playwright separately; never bundle test fixtures/tooling into production.
NODE_PATH=/path/to/browser-test/node_modules node tool/pwa_browser_smoke.cjs
```

Output: `build/web`, served beneath `/app/`. The dedicated GitHub workflow uploads this folder as `flupflap-pwa`. Compiled source maps and legacy Flutter workers are removed. CanvasKit/fonts are served locally. The website integration pins a reviewed Ticash commit and the exact official Flutter SDK commit, preserves the existing root build, and stages the PWA beneath `/app/`.

## Validation completed locally

- Release web compilation succeeded.
- FlupFlap: analyzer clean, 235 tests passed including browser cookie restoration and native startup regression checks.
- Shared mobile: analyzer clean, 86 tests passed.
- Backend: typecheck, lint, build and 948 tests passed (UTC test environment; local timezone caused two existing database timestamp assertions to differ).
- Public cache/manifest: 3 tests passed.
- Real Chromium with production-like CSP: login renders, manifest validates, worker activates, offline shell reloads, credentials are absent from browser storage, return capability is scrubbed and return flow does not create a payment/recharge.

No live payment/recharge, provider purchase, database migration, Android signing change or deployment was performed. Physical iPhone/Safari installation, actual provider delivery and approved sandbox card Checkout remain release QA requirements.
