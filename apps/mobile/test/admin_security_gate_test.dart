import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/screens/admin/admin_security_gate.dart';

class MfaFixture implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    requests.add(options);
    final data = options.path.endsWith('/start')
        ? {'challengeId': 'fixture-id'}
        : options.path.endsWith('/setup')
        ? {'secret': 'FIXTURE-ONLY-SETUP-KEY'}
        : options.path.endsWith('/confirm')
        ? {
            'proof': 'fixture-proof',
            'recoveryCodes': ['fixture-backup-one', 'fixture-backup-two'],
          }
        : {'enabled': false, 'available': true, 'required': true};
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
  testWidgets(
    'admin enrollment waits for inbox proof, authenticator proof and recovery-code acknowledgement',
    (tester) async {
      final adapter = MfaFixture();
      final dio = Dio()..httpClientAdapter = adapter;
      var opened = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AdminSecurityGate(dio: dio, onVerified: () => opened = true),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(opened, false);
      await tester.enterText(find.byType(TextField).first, 'fixture-password');
      await tester.tap(find.text('Send setup email'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, '123456');
      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();
      expect(find.text('FIXTURE-ONLY-SETUP-KEY'), findsOneWidget);
      expect(opened, false);
      await tester.enterText(find.byType(TextField).last, '654321');
      await tester.tap(find.text('Verify'));
      await tester.pumpAndSettle();
      expect(dio.options.headers['X-Admin-MFA'], 'fixture-proof');
      expect(opened, false);
      expect(find.textContaining('fixture-backup-one'), findsOneWidget);
      await tester.tap(find.text('I saved my recovery codes — continue'));
      expect(opened, true);
      expect(adapter.requests.map((r) => r.path), [
        '/admin/security',
        '/admin/security/start',
        '/admin/security/setup',
        '/admin/security/confirm',
      ]);
    },
  );
}
