// Visual QA with provider-shaped fixtures only; no live purchase or recharge.
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/recharge_screen.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'checkout_parity_test.dart' show fixture;
import 'airtime_selection_test.dart' show loadProducts;
import 'parity_widget_test.dart' show shell, capture;

void main() {
  setUpAll(() async {
    final font = Platform.environment['FLUPFLAP_TEST_FONT'];
    if (font != null) {
      await (FontLoader('Roboto')..addFont(Future.value(
        ByteData.sublistView(File(font).readAsBytesSync())))).load();
    }
  });
  for (final size in [const Size(360, 900), const Size(412, 915), const Size(1024, 1536)]) {
    testWidgets('bundle screen visual ${size.width.toInt()}', (t) async {
      t.view.physicalSize = size;
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.resetPhysicalSize);
      addTearDown(t.view.resetDevicePixelRatio);
      final (adapter, _, j) = fixture();
      adapter.products..clear()..addAll([
        for (final item in [(7, 7, 5), (2, 7, 7), (4, 7, 10), (4, 15, 18), (8, 30, 26)])
          {'id': 'fixture-${item.$3}', 'operatorId': 9,
            'name': 'Talk + Data Bundle', 'kind': 'BUNDLE',
            'price': item.$3, 'priceCurrency': 'USD', 'deliveredCurrency': 'HTG',
            'amountType': 'FIXED',
            'description': '${item.$1}GB data - ${item.$1}GB Bonus Data - Unlimited WhatsApp - ${item.$2} Days',
            'benefits': [{'type': 'DATA', 'amount': item.$1, 'unit': 'GB'},
              {'type': 'MINUTES', 'amount': -1, 'unit': 'MINUTES'}],
            'validity': {'quantity': item.$2, 'unit': 'DAY'}},
        {'id': 'fixture-mega', 'operatorId': 9, 'name': 'Mega Bundle',
          'kind': 'BUNDLE', 'price': 36, 'priceCurrency': 'USD',
          'deliveredCurrency': 'HTG', 'amountType': 'FIXED',
          'description': "Unlimited on-net calls - 30 mins Natcom/US/CAN - 70GB any use Data - 50GB D'Music - 50GB PlayGO - 50GB BiP - 30 DAY"},
      ]);
      await t.runAsync(() => loadProducts(j));
      j.internet = true;
      j.operators = [MobileTopUpOperator.fromJson({
        'id': 9, 'name': 'Digicel Haiti Bundles', 'countryCode': 'HT', 'bundle': true})];
      j.operator = j.operators.single;
      await t.pumpWidget(shell(Scaffold(body: RechargeJourneyScreen(journey: j),
        bottomNavigationBar: NavigationBar(selectedIndex: 1, destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.phone_android), label: 'Recharge'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: 'History'),
          NavigationDestination(icon: Icon(Icons.people_outline), label: 'Recipients'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Account'),
        ]))));
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
      final prefix = Platform.environment['BUNDLE_SCREENSHOT_PREFIX'] ?? 'after';
      await capture(t, '$prefix-bundles-${size.width.toInt()}');
      await t.drag(find.byType(ListView).first, const Offset(0, -550));
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
      await capture(t, '$prefix-bundles-${size.width.toInt()}-scrolled');
    });
  }
}
