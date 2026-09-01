# TiCash Mobile (Flutter)

Production customer-facing mobile app for TiCash, built with Flutter for a
single codebase across iOS and Android.

## Architecture

- **State management:** [Riverpod](https://riverpod.dev/) (`flutter_riverpod`)
- **Dependency injection:** [get_it](https://pub.dev/packages/get_it)
- **Networking:** [Dio](https://pub.dev/packages/dio) with interceptors for
  attaching JWT access tokens and silently refreshing them on `401` responses
- **Routing:** [go_router](https://pub.dev/packages/go_router)
- **Push notifications / analytics:** Firebase (`firebase_messaging`,
  `firebase_analytics`, `firebase_crashlytics`)
- **Secure storage:** `flutter_secure_storage` for JWTs and other sensitive
  data
- **Biometrics:** `local_auth` for Face ID / fingerprint login and transfer
  authorization
- **ID verification:** `camera` / `image_picker` for KYC document capture
- **Local caching:** `sqflite` for offline-friendly data
- **Animations:** `flutter_animate`

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

- [Flutter SDK](https://docs.flutter.dev/get-started/install) `>=3.19.0`
- Xcode (for iOS builds) and Android Studio / SDK (for Android builds)
- A Firebase project with Android/iOS apps registered (for push notifications)

### Setup

```bash
cd apps/mobile
cp .env.example .env      # fill in API_BASE_URL and Firebase values
flutter pub get
```

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
