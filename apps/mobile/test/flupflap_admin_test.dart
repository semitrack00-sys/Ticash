import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/screens/admin/flupflap_admin_page.dart';
import 'package:ticash/services/admin_service.dart';

class AdminFixture implements HttpClientAdapter {
  final requests = <String>[];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? request,
    Future<void>? cancel,
  ) async {
    requests.add(options.path);
    final data = options.path.endsWith('/customers')
        ? {
            'customers': [
              {
                'id': 'fixture-customer',
                'domain': 'FLUPFLAP',
                'email': 'fixture@example.test',
                'rechargeRestricted': false,
              },
            ],
          }
        : {'domain': 'FLUPFLAP', 'environment': 'SANDBOX'};
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
    'no recharge permission means no admin requests or customer records',
    (tester) async {
      final adapter = AdminFixture();
      final dio = Dio()..httpClientAdapter = adapter;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FlupFlapAdminPage(
              dio: dio,
              session: const AdminSession(
                role: 'CUSTOMER',
                permissions: {},
                environment: 'SANDBOX',
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(adapter.requests, isEmpty);
      expect(find.textContaining('cannot access'), findsOneWidget);
    },
  );
  testWidgets(
    'read-only staff see separate FlupFlap customers without mutation controls',
    (tester) async {
      final adapter = AdminFixture();
      final dio = Dio(BaseOptions(baseUrl: 'https://fixture.example.test/api'))
        ..httpClientAdapter = adapter;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FlupFlapAdminPage(
              dio: dio,
              session: const AdminSession(
                role: 'READ_ONLY',
                permissions: {'recharge.view', 'recharge.customers.view'},
                environment: 'SANDBOX',
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('FlupFlap Customers'));
      await tester.pumpAndSettle();
      expect(find.textContaining('fixture@example.test'), findsOneWidget);
      expect(find.text('Restrict recharge'), findsNothing);
      expect(
        adapter.requests.every((p) => p.startsWith('/admin/flupflap/')),
        true,
      );
      expect(find.text('Refunds'), findsNothing);
    },
  );
}
