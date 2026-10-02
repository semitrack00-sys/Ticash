# Android web parity implementation

Baseline: `5ef057b871bba1ee82a69f8efece4f51450569d5`.
Branch: `codex/flupflap-android-web-parity`.

## Audited gaps and implementation order

1. Extend the shared client/model contracts: catalog version, provider range rules, backend payment mode, hosted sessions and public checkout-resume DTO.
2. Add an explicit destination → operator/product → review → payment/result state machine. Invalidate downstream state on edits; preserve unresolved payment attempts and idempotency keys.
3. Bundle existing website country flags; keep backend countries authoritative.
4. Open only validated Stripe hosted Checkout URLs. Retain explicit MOCK-only purchase behavior. Add a compatible Android return handoff without changing existing web redirects or webhook fulfillment.
5. Integrate existing marketing visit/attribution, quote presentation, referral URL and QR endpoints. Keep capabilities in memory and restrict referral generation to registered customers.
6. Extend the existing five-language Flutter localization architecture, account, history and recipients.
7. Test mocked live/sandbox/MOCK contracts, safety, navigation, responsive layouts and both Flutter packages; build Android QA artifacts.

The backend already requires `catalogVersion` for DATA/BUNDLE quotes. The old Flutter product model drops it; this must be retained and submitted, never synthesized. Guest billing country is temporary request context; permanent customers use their stored billing country. The resume endpoint returns a public DTO without an internal transaction ID and must have its own parser.

No real payment, recharge, provider call, SMS, deployment or migration is part of validation. Release signing guards remain unchanged.

## Runtime and security contract

The backend alone supplies availability and pricing. Complete live flags plus STRIPE_LIVE/CARD are required for live Checkout; complete sandbox flags plus STRIPE_SANDBOX/CARD are required for test Checkout. Explicit safe MOCK uses the existing transaction endpoint. There is no fallback between modes. The app does not calculate fees, promotions or receiver values, and never collects card details.

A session-owned controller retains one attempt key across retries and tab/browser navigation. Unknown or unresolved attempts remain locked. Restart checks authenticated transaction history before enabling another attempt. Quotes bind country/number/operator/product/catalog version; edits clear downstream state. Repeat asks the backend for a fresh quote. Guest billing country is temporary and independent of the destination; permanent customers continue using their stored profile.

The new FlupFlap-only `returnTarget: FLUPFLAP_ANDROID` payment-session option chooses a fixed HTTPS handoff on the existing API. Omitting it preserves the configured web success/cancel URLs. The handoff provides an explicit Android package intent and existing web recovery fallback, with no scripts, no-store and no-referrer headers. It never fulfills a recharge. The raw capability stays in memory; the routed app URL is immediately replaced with `/checkout-return`. Both initial and subsequent returns call only the existing read-only checkout-resume endpoint. Polling is five seconds, at most 24 scheduled reads, and stops at terminal state. Webhooks/server fulfillment remain authoritative.

The backend addition must be reviewed and deployed through the normal release process before this APK can use its Android-specific return option against production. No deployment is performed by this change. Verified HTTPS Android App Links still require approved domain/signing association; this implementation uses the package-bound Android intent handoff instead of claiming such verification.

Marketing uses only existing visit/signup-started/attribution/quote/share/QR endpoints. Acquisition capabilities are memory-only, cleared on sign-out and protected against late completion. Registered customers can share the backend-issued referral URL/QR through native intents, copy, WhatsApp or SMS composition. Guests cannot request a referral code. No SMS is sent during validation.

The five-language catalog extends the existing TiCash AppLocalizationScope. Provider names/descriptions are displayed as returned, not replaced with fabricated localized products. Local flags are display assets only; see FLAG_ASSETS.md.

## Validation and artifact notes

Tests use fixtures only. The two external-provider enable flags must be disabled in the test process when a developer `.env` enables Ding/DT One. The first full API run inherited those settings and failed three configuration assertions; running with DING_ENABLED=false and DTONE_ENABLED=false passed 786/786. No `.env` file was modified.

- Backend: 786 tests; focused payment suite 139 tests. Typecheck, lint, build, Prisma validation/generation passed. No migration was created or executed.
- Shared TiCash mobile: analysis clean; 76 tests passed.
- Standalone app: analysis clean; 86 tests passed. This includes repeat-after-completed-session regression coverage. Debug APK and QA debug AAB builds passed with the production API base URL; neither was installed. Builds warn about future Flutter support for existing Gradle/AGP/Kotlin versions; no bypass flags or signing changes were used.
- Production npm audit: two existing moderate advisories (express-rate-limit and ip-address), zero high/critical. Dependency versions were not changed to hide advisories.
- Optional test screenshots live outside source under the local task's `artifacts/parity-screenshots` directory. They are not packaged into the APK.
- Android release key.properties is absent. Production signed release remains blocked; the signing guard is unchanged. Debug APK/AAB are QA artifacts only.

## Device QA checklist (not performed automatically)

1. Install the validated debug APK only with explicit user approval. Confirm com.ticash.flupflap, not the TiCash package.
2. Login, signup, guest entry, recovery, language switching and sign-out; verify TiCash identities cannot cross into FlupFlap.
3. Verify local flags and ISO fallback, detection/manual operators, logos/error fallback, fixed products, DATA/BUNDLE snapshots and provider range increments.
4. Review server receiver value, fee/promo rows, expiry, total and billing country; verify HT destination with US guest billing and stored permanent billing.
5. On an approved sandbox backend only, open hosted Checkout, cancel/return, background/resume and reopen the return link. Confirm only backend state changes the result.
6. While unresolved, test Back, tabs, network interruption and app restart. Retry must retain the reservation, never create a second payment/recharge.
7. Check pending/delivered/failure/refund/void receipts, discrepancies, history and repeat with a fresh quote.
8. Verify registered referral link/QR and native copy/share composition; guest referral restriction; promo eligibility remains backend-controlled.
9. Check 360/375/390/412/430/768 widths, 1.0/1.5 text, keyboard and small/large real Android devices. Automated widget coverage supplements but does not replace this physical-device QA.

No real payment, recharge, provider purchase, SMS, production environment change, migration or installation was performed.
