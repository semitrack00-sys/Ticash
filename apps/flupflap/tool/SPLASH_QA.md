# Login and native splash visual QA

The login retains the original full `assets/flupflap-logo.png`. The installed launcher continues to use `@drawable/flupflap_icon`; neither the manifest nor its drawable/bitmap changed.

The dedicated native asset is `android/app/src/main/res/drawable-nodpi/flupflap_f_glossy.png`. It contains only the transparent glossy F. Both legacy launch backgrounds use its 160dp transparent canvas. Android 12+ uses 22.2222% fractional insets, leaving 160/288 of its canvas for the same asset inside the platform's safe circle. Fractional padding survives Android's initial launcher-size rasterization; fixed dp child dimensions would be clipped before enlargement. Day/night launch and normal window backgrounds are white. No artificial startup delay, extra Flutter splash, or activity/authentication behavior was added.

Platform sizing reference: [Android splash screen dimensions](https://developer.android.com/develop/ui/views/launch/splash-screen#dimensions).

The asset was extracted with the built-in imagegen tool from the user's approved glossy F screenshot. Prompt: “Extract ONLY the glossy multicolor FlupFlap F; preserve the flowing shape and cyan/blue upper, yellow/orange/pink middle, and purple lower strokes. Remove the white background and phone UI. Use genuine transparency, crisp edges, a centered square canvas, and no wordmark, frame, rounded-square background, phone/card artwork, or added decoration.” The original full logo was not edited.

## Reproduce

- `flutter pub get`, `flutter analyze`, `flutter test` from `apps/flupflap`.
- Responsive widget coverage: 320x640, 360x800, 360x900, 390x844, 412x915, 430x932, text scales 1.0/1.5, and keyboard insets. All registration normalization tests remain in the full suite.
- Optional widget PNGs: set `FLUPFLAP_TEST_FONT` to Roboto-Regular.ttf (with materialicons-regular.otf beside it) and `FLUPFLAP_SCREENSHOT_DIR` to a writable directory, then run `flutter test test/onboarding_marketing_test.dart`.
- The Android workflow builds debug APK/AAB, then installs that exact APK on fresh API 30/31 emulators, disables networking, and records a normal cold launch by tapping the real launcher icon. Its position comes from the launcher accessibility tree. This avoids the [Android 12 ADB/IDE launch limitation](https://issuetracker.google.com/issues/207386164). The capture scripts introduce no app delay and never authenticate or invoke a transaction.
- Each `flupflap-native-splash-api-*` artifact contains an **unmodified emulator frame** `splash-native.png`, a native login screenshot, and the startup video. Frame selection checks that the only colored content is the small centered F on white. Inspect the video if an assertion fails.
