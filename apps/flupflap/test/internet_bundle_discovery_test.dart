import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/recharge_screen.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'checkout_parity_test.dart' show fixture;
import 'airtime_selection_test.dart' show loadProducts;
import 'parity_widget_test.dart' show shell, press;

void main() {
  test('service flags survive decoding for bundles, data and combo operators', () {
    for (final flag in ['bundle', 'data', 'combo']) {
      final op = MobileTopUpOperator.fromJson({
        'id': 682, 'name': 'Provider plan', 'countryCode': 'HT', flag: true,
      });
      expect(op.internetService, isTrue, reason: flag);
    }
    expect(MobileTopUpOperator.fromJson({
      'id': 174, 'name': 'Natcom Haiti', 'countryCode': 'HT',
    }).internetService, isFalse);
  });

  testWidgets('internet selector clears airtime and loads the separate bundle ID', (t) async {
    final (adapter, _, j) = fixture();
    addTearDown(j.dispose);
    await loadProducts(j);
    final bundle = MobileTopUpOperator.fromJson({
      'id': 682, 'name': 'Natcom Haiti Bundles', 'countryCode': 'HT', 'bundle': true,
    });
    j.operators = [...j.operators, bundle];
    await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
    await t.pumpAndSettle();
    await press(t, find.widgetWithText(ChoiceChip, 'Internet & bundles'));
    expect(j.operator, isNull);
    expect(j.products, isEmpty);
    expect(j.quote, isNull);
    expect(j.serviceOperators, [bundle]);
    adapter.products
      ..clear()
      ..add({
        'id': 'natcom-bundle', 'operatorId': 682, 'name': 'Provider internet plan',
        'kind': 'BUNDLE', 'price': 5, 'priceCurrency': 'USD',
        'deliveredCurrency': 'HTG', 'amountType': 'FIXED',
      });
    await t.tap(find.byType(DropdownButtonFormField<int>));
    await t.pumpAndSettle();
    await t.tap(find.text('Natcom Haiti Bundles').last);
    await t.pumpAndSettle();
    expect(j.operator?.id, 682);
    expect(j.products.single.id, 'natcom-bundle');
    expect(find.text('Provider internet plan'), findsOneWidget);
    expect(adapter.requests.lastWhere((r) => r.path.endsWith('/products')).path, endsWith('/operators/682/products'));
    expect(adapter.quoteCount, 0);
    expect(t.takeException(), isNull);
    await press(t, find.widgetWithText(ChoiceChip, 'Airtime'));
    expect(j.operator, isNull);
    expect(j.products, isEmpty);
    expect(j.serviceOperators.any((o) => o.id == 682), isFalse);
  });

  test('internet preference never substitutes the detected airtime operator', () async {
    final (_, _, j) = fixture();
    addTearDown(j.dispose);
    j.selectService(true);
    await loadProducts(j);
    expect(j.operator, isNull);
    expect(j.products, isEmpty);
    expect(j.serviceOperators, isEmpty);
  });
}
