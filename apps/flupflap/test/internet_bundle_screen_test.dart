import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/main.dart';
import 'package:flupflap/session.dart';
import 'flupflap_test.dart' show MemoryStorage;
import 'premium_ui_test.dart' show CatalogAdapter, recipient, terms, tap, screenshot;

// Test transport only. Production continues to consume the real catalog.
class BundleScreenAdapter extends CatalogAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? stream,
      Future<void>? cancel) async {
    Object? data;
    if (o.path.endsWith('/operators')) {
      data = {'operators': [
        {'id': 255, 'name': 'Test airtime operator', 'countryCode': 'US', 'bundle': false},
        {'id': 682, 'name': 'Test Internet Bundles', 'countryCode': 'US', 'bundle': true},
      ]};
    } else if (o.path.endsWith('/operators/682/products')) {
      data = {'products': [
        for (final days in [7, 15, 30]) {
          'id': 'bundle-$days', 'operatorId': 682, 'kind': 'BUNDLE',
          'name': 'Internet Bundle', 'price': days == 7 ? 5 : days.toDouble(),
          'priceCurrency': 'USD', 'deliveredCurrency': 'USD', 'amountType': 'FIXED',
          'benefits': [
            {'type': 'DATA', 'amount': 7, 'unit': 'GB'},
            {'type': 'MINUTES', 'amount': -1, 'unit': 'MINUTES'},
          ],
          'validity': {'quantity': days, 'unit': 'DAY'},
        },
      ]};
    } else if (o.path.endsWith('/quotes')) {
      data = {'quote': {
        ...terms, 'id': 'quote-fixture', 'operatorId': 682,
        'operatorName': 'Test Internet Bundles', 'productId': 'bundle-7',
        'productName': 'Internet Bundle', 'kind': 'BUNDLE',
        'expiresAt': '2099-01-01T00:00:00Z',
      }};
    }
    if (data == null) return super.fetch(o, stream, cancel);
    requests.add(o);
    return ResponseBody.fromString(jsonEncode(data), 200,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }
}

void main() {
  setUpAll(() async {
    final root = Platform.environment['FLUTTER_ROOT'];
    if (Platform.environment['FLUPFLAP_SCREENSHOT_DIR'] == null || root == null) return;
    for (final entry in {'Roboto': 'Roboto-Regular.ttf', 'MaterialIcons': 'MaterialIcons-Regular.otf'}.entries) {
      var file = File('$root/bin/cache/artifacts/material_fonts/${entry.value}');
      if (!await file.exists() && entry.key == 'MaterialIcons') {
        file = File('$root/bin/cache/artifacts/material_fonts/materialicons-regular.otf');
      }
      await (FontLoader(entry.key)..addFont(Future.value(
          ByteData.sublistView(await file.readAsBytes())))).load();
    }
  });

  for (final width in [360.0, 412.0, 1024.0]) {
    testWidgets('bundle screen and server fee review at $width', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(width, 1000);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final adapter = BundleScreenAdapter();
      final session = FlupFlapSession(
        dio: Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
          ..httpClientAdapter = adapter,
        storage: MemoryStorage(),
      );
      await session.initialize();
      await tester.runAsync(() => session.login('customer@example.test', 'test-password'));
      await tester.pumpWidget(FlupFlapApp(session: session));
      await tester.pumpAndSettle();
      await tap(tester, find.widgetWithText(NavigationDestination, 'Recipients'));
      await tap(tester, find.text(recipient['nickname']!));
      await tap(tester, find.text('Continue'));
      await tap(tester, find.widgetWithText(ChoiceChip, 'Internet & bundles'));
      await tap(tester, find.byType(DropdownButtonFormField<int>));
      await tap(tester, find.text('Test Internet Bundles').last);
      expect(find.text('Internet & Bundles'), findsOneWidget);
      expect(find.text('Choose a plan that fits your needs'), findsOneWidget);
      expect(find.widgetWithText(NavigationDestination, 'Recharge'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await screenshot(tester, 'bundle-screen-${width.toInt()}');
      await tap(tester, find.byKey(const ValueKey('bundle-buy-bundle-7')));
      await tap(tester, find.text('Continue'));
      final request = adapter.requests.singleWhere((r) => r.path.endsWith('/quotes'));
      expect(request.data['productId'], 'bundle-7');
      expect(request.data['operatorId'], 682);
      expect(find.text('5.00 USD'), findsWidgets);
      expect(find.text('1.24 USD'), findsOneWidget);
      expect(find.text('6.24 USD'), findsOneWidget);
      expect(adapter.requests.where((r) => r.path.endsWith('/payment-sessions')), isEmpty);
      expect(tester.takeException(), isNull);
      await screenshot(tester, 'bundle-review-${width.toInt()}');
      await tester.pumpWidget(const SizedBox());
    }, timeout: const Timeout(Duration(seconds: 60)));
  }
}
