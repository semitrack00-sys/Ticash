import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/config/routes.dart';

void main() {
  test('public app-link paths map to stable route aliases', () {
    expect(AppRoutes.send, '/send');
    expect(AppRoutes.recharge, '/recharge');
    expect(AppRoutes.login, '/login');
    expect(AppRoutes.support, '/support');
  });

  test('post-login continuation is allowlisted', () {
    expect(AppRoutes.safeContinuation('/send'), '/send');
    expect(AppRoutes.safeContinuation('/recharge'), '/recharge');
    expect(AppRoutes.safeContinuation('/support'), '/support');
    expect(AppRoutes.safeContinuation('https://example.com'), isNull);
    expect(AppRoutes.safeContinuation('//example.com'), isNull);
    expect(AppRoutes.safeContinuation('/activity/private-id'), isNull);
    expect(AppRoutes.safeContinuation(null), isNull);
    expect(AppRoutes.requiresKyc('/send'), isTrue);
    expect(AppRoutes.requiresKyc('/recharge'), isTrue);
    expect(AppRoutes.requiresKyc('/support'), isFalse);
    expect(
      AppRoutes.withContinuation(AppRoutes.login, AppRoutes.send),
      '/login?continue=%2Fsend',
    );
    expect(
      AppRoutes.withContinuation(AppRoutes.kyc, AppRoutes.recharge),
      '/kyc?continue=%2Frecharge',
    );
  });

  test('Android manifest declares verified HTTPS links only', () {
    final manifest = File(
      'android/app/src/main/AndroidManifest.xml',
    ).readAsStringSync();

    expect(manifest, contains('android:autoVerify="true"'));
    expect(manifest, contains('android:scheme="https"'));
    expect(manifest, contains('android:host="ticash-app.com"'));
    expect(manifest, contains('android:host="www.ticash-app.com"'));
    for (final path in ['/send', '/recharge', '/login', '/support']) {
      expect(manifest, contains('android:path="$path"'));
      expect(manifest, contains('android:path="$path/"'));
    }
    expect(manifest, isNot(contains('android:scheme="http"')));
  });

  test('iOS associated domains use only official HTTPS hosts', () {
    final entitlements = File(
      'ios/Runner/Runner.entitlements',
    ).readAsStringSync();

    expect(entitlements, contains('applinks:ticash-app.com'));
    expect(entitlements, contains('applinks:www.ticash-app.com'));
    expect(entitlements, isNot(contains('applinks:http')));
  });
}
