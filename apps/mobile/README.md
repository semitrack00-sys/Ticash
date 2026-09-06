# TiCash Mobile (Flutter)

Customer-facing mobile application for TiCash, built with Flutter for a
single codebase across iOS and Android.

## Architecture

- **State management:** [Riverpod](https://riverpod.dev/) (`flutter_riverpod`)
- **Networking:** [Dio](https://pub.dev/packages/dio) with interceptors for
  attaching JWT access tokens and silently refreshing them on `401` responses
- **Routing:** [go_router](https://pub.dev/packages/go_router)
- **Secure storage:** `flutter_secure_storage` for JWTs and other sensitive
  data
- **Persistence:** PostgreSQL through the TiCash API
- **KYC:** native Didit verification launched with a short-lived session token
  created by the TiCash API; signed Didit webhooks remain the source of truth
  for customer approval

## Project layout

```
lib/
  main.dart              # App entry point
  config/                # API config, routing, theming
  models/                # User, Transfer, Recipient, KYC data models
  services/               # API client, auth, storage, notifications
  screens/                # Auth, Home, Transfer, Recipients, Profile
  widgets/                # Reusable UI components
  providers/              # Riverpod providers/state
test/                    # Unit and widget tests
android/                 # Android platform project
ios/                     # iOS platform project
```

## Getting started

### Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) `>=3.38.4`
- Xcode (for iOS builds) and Android Studio / SDK (for Android builds)
- A running TiCash API and PostgreSQL database

### Setup

```bash
cd apps/mobile
cp .env.example .env      # reference values for local tooling only; the
                           # app itself reads config via --dart-define at
                           # build/run time (see below), not from this file
flutter pub get
```

Configuration such as `API_BASE_URL` is passed at build time. Build-time URLs
are visible in the compiled app and must never contain secrets:

```bash
flutter run --dart-define=API_BASE_URL=http://localhost:4000/api
```

Didit secrets are configured only on the TiCash API. The mobile app receives a
session token from `POST /api/kyc/session`; it never receives the Didit API key
or webhook secret. See the repository-level `DIDIT_KYC.md` for backend and
Didit Dashboard setup.

### Run

```bash
flutter run
```

### Test

```bash
flutter test
```

### Build

```bash
# Android
flutter build apk --release

# iOS (requires macOS + Xcode)
flutter build ios --release --no-codesign
```

### Android signing

Copy `android/key.properties.example` to `android/key.properties` and fill
in your upload keystore details. This file is gitignored and must never be
committed.

### iOS setup

Run `pod install` inside `ios/` after `flutter pub get` to install CocoaPods
dependencies. Configure signing in Xcode (`ios/Runner.xcworkspace`) with your
Apple Developer team before archiving a release build.

## Website links

The official public domain is `https://ticash-app.com`. The app supports these
public paths without placing authenticated or financial data in the URL:

- `/send` opens the existing Send Money screen
- `/recharge` opens the existing Mobile Recharge screen
- `/login` opens sign in
- `/support` opens support

The Android declaration also accepts the equivalent trailing-slash paths used
by static hosting (for example `/send/` and `/recharge/`).

The legacy internal paths `/transfer` and `/mobile-recharge` remain available
for existing in-app navigation.

Android App Links are declared for the production HTTPS domain. They will not
verify until the website's `assetlinks.json` contains the SHA-256 fingerprint
of the real release/Play App Signing certificate. Do not use the debug signing
certificate for production.

The iOS associated-domains entitlement is prepared in
`ios/Runner/Runner.entitlements`. The checked-out iOS project does not include
an Xcode project or a final bundle/team identifier, so the entitlement still
must be attached to the Runner target on macOS. The website's Apple association
file must then be populated with the real Apple Team ID and final bundle ID.

The app accepts only an allowlisted local path as a post-login continuation.
It preserves that path through registration and required KYC, then opens it
only after the account reaches the authoritative approved KYC state. It never
accepts an arbitrary URL, avoiding an open-redirect path. KYC and all backend
authorization requirements remain in force after a deep link.

Live funding and MonCash/NatCash payouts are intentionally unavailable until
official provider contracts, sandbox certification, webhook verification, and
reconciliation controls are completed.

The public website repository contains the full
`PRODUCTION_ACTIVATION_CHECKLIST.md`. Release identifiers, signing-certificate
fingerprints, store URLs, and Apple account values must be supplied from the
real enrolled accounts; placeholders must never be activated.
