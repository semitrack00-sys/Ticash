import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/screens/admin/flupflap_admin_page.dart';
import 'package:ticash/services/admin_service.dart';

class AdminFixture implements HttpClientAdapter {
  final requests = <String>[];
  final resets = <Map<String, dynamic>>[];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? request,
    Future<void>? cancel,
  ) async {
    requests.add(options.path);
    if (options.path.endsWith('/purchase-attempts/reset')) {
      resets.add(Map<String, dynamic>.from(options.data as Map));
      return ResponseBody.fromString(jsonEncode({'resetCount': 3, 'otherLimitsStillApply': true}), 200,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    }
    final data = options.path.endsWith('/customer-directory')
        ? {
            'domain': 'FLUPFLAP', 'kind': 'CLIENTS', 'mode': 'live', 'metric': 'clients.total',
            'total': 1, 'overallTotal': 1, 'offset': 0, 'nextOffset': null,
            'countries': [{'code': 'US', 'name': 'United States', 'total': 1}],
            'rows': [
              {
                'id': 'fixture-customer',
                'domain': 'FLUPFLAP',
                'email': 'fixture@example.test',
                'rechargeRestricted': false,
                'firstName': 'Fixture', 'lastName': 'Customer', 'countryCode': 'US', 'status':'ACTIVE',
                'createdAt': '2026-10-01T10:00:00Z',
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
  testWidgets('directory preserves audited recharge restriction controls', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 1000)); addTearDown(() => tester.binding.setSurfaceSize(null));
    final adapter = AdminFixture();
    final dio = Dio(BaseOptions(baseUrl: 'https://fixture.example.test/api'))..httpClientAdapter = adapter;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: FlupFlapAdminPage(dio: dio,
      session: const AdminSession(role: 'ADMIN', permissions: {'recharge.view','recharge.customers.view','recharge.operations'}, environment: 'PRODUCTION')))));
    await tester.pumpAndSettle(); await tester.tap(find.text('FlupFlap Customers')); await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Restrict recharge')); await tester.pumpAndSettle();
    await tester.tap(find.text('Restrict recharge')); await tester.pumpAndSettle();
    await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)), 'Reviewed access with the customer');
    await tester.pumpAndSettle(); await tester.tap(find.text('Confirm')); await tester.pumpAndSettle();
    expect(adapter.requests, contains('/admin/flupflap/customers/fixture-customer/restrictions'));
    expect(adapter.requests.where((p) => p.endsWith('/customer-directory')).length, greaterThanOrEqualTo(2));
    expect(tester.takeException(), isNull);
  });
  testWidgets('admin reset requires review reason and reports the scoped result', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final adapter = AdminFixture();
    final dio = Dio(BaseOptions(baseUrl: 'https://fixture.example.test/api'))..httpClientAdapter = adapter;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: FlupFlapAdminPage(
      dio: dio, session: const AdminSession(role: 'ADMIN', permissions: {
        'recharge.view', 'recharge.customers.view', 'recharge.attempts.reset',
      }, environment: 'PRODUCTION'),
    ))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('FlupFlap Customers'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Reset purchase-attempt limit'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reset purchase-attempt limit'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reset attempt count'));
    await tester.pumpAndSettle();
    expect(adapter.resets, isEmpty);
    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.enterText(find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)),
      'Reviewed failed reservations with the customer');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reset attempt count'));
    await tester.pumpAndSettle();
    expect(adapter.resets, hasLength(1));
    expect(adapter.resets.single['reason'], 'Reviewed failed reservations with the customer');
    expect(adapter.resets.single['requestId'], matches(RegExp(r'^[a-f0-9]{32}$')));
    expect(find.textContaining('3 failed reservation counts reset.'), findsOneWidget);
  });
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
      expect(find.text('Reset purchase-attempt limit'), findsNothing);
      expect(
        adapter.requests.every((p) => p.startsWith('/admin/flupflap/')),
        true,
      );
      expect(find.text('Refunds'), findsNothing);
    },
  );
  testWidgets(
    'FlupFlap admin keeps Internet Plans as a stable navigation section',
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
                role: 'ADMIN',
                permissions: {'recharge.view', 'recharge.providers.view'},
                environment: 'SANDBOX',
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Internet Plans'), findsOneWidget);
      expect(find.text('Products'), findsNothing);
    },
  );
}
