import 'dart:typed_data';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/session.dart';
import 'package:flupflap/main.dart';

import 'flupflap_test.dart' show MemoryStorage;

class SecurityAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    requests.add(options);
    final data = options.path.endsWith('/login')
        ? {
            'code': 'LOGIN_VERIFICATION_REQUIRED',
            'challengeId': 'fixture-challenge',
            'expiresInSeconds': 600,
          }
        : {
            'accessToken': 'fixture-access',
            'refreshToken': 'fixture-refresh',
            'trustedDeviceToken': 'fixture-trust',
            'user': {
              'id': 'fixture-customer',
              'domain': 'FLUPFLAP',
              'email': 'buyer@example.test',
              'guest': false,
            },
          };
    return ResponseBody.fromString(
      jsonEncode(data),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('email challenge does not authenticate; completing it stores native device trust separately', () async {
    final adapter = SecurityAdapter(),
        storage = MemoryStorage(),
        trust = MemoryStorage();
    final dio = Dio(BaseOptions(baseUrl: 'https://fixture.example.test/api'))
      ..httpClientAdapter = adapter;
    final session = FlupFlapSession(
      dio: dio,
      storage: storage,
      trustedDeviceStorage: trust,
    );
    await session.login('buyer@example.test', 'fixture-password');
    expect(session.authenticated, false);
    expect(session.loginChallengeId, 'fixture-challenge');
    expect(storage.value, isNull);
    await session.confirmLogin('123456');
    expect(session.authenticated, true);
    expect(session.loginChallengeId, isNull);
    expect(storage.value, 'fixture-refresh');
    expect(trust.value, 'fixture-trust');
    await session.signOutAll('fixture-password');
    expect(session.authenticated, false);
    expect(storage.value, isNull);
    expect(trust.value, isNull);
    expect(adapter.requests.last.path, '/flupflap/auth/sessions/revoke-all');
    session.dispose();
  });
  testWidgets(
    'unfamiliar sign-in displays the email-code screen and supports returning to password sign-in',
    (tester) async {
      final adapter = SecurityAdapter();
      final dio = Dio(BaseOptions(baseUrl: 'https://fixture.example.test/api'))
        ..httpClientAdapter = adapter;
      final session = FlupFlapSession(dio: dio, storage: MemoryStorage());
      await session.login('buyer@example.test', 'fixture-password');
      await tester.pumpWidget(MaterialApp(home: AuthScreen(session: session)));
      await tester.pumpAndSettle();
      expect(find.text('Verify sign-in'), findsOneWidget);
      expect(find.textContaining('unfamiliar sign-in'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(session.loginChallengeId, isNull);
      expect(session.authenticated, false);
      await tester.pumpWidget(const SizedBox.shrink());
      session.dispose();
    },
  );
}
