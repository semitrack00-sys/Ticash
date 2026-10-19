import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/internet_bundle_card.dart';
import 'package:flupflap/recharge_screen.dart';
import 'package:flupflap/recharge_journey.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'parity_widget_test.dart' show shell, press;
import 'checkout_parity_test.dart' show fixture;
import 'airtime_selection_test.dart' show loadProducts;

Map<String, dynamic> offer({int days = 7}) => {
  'id': 'bundle-$days', 'operatorId': 9, 'name': 'Provider Internet Bundle',
  'kind': 'BUNDLE', 'price': 5.35, 'priceCurrency': 'USD',
  'deliveredCurrency': 'HTG', 'amountType': 'FIXED',
  'catalogVersion': 'bundle-snapshot',
  'description': '7GB data - 2GB Bonus Data - Unlimited WhatsApp - $days Days',
  'benefits': [{'type': 'DATA', 'amount': 7, 'unit': 'GB'},
    {'type': 'MINUTES', 'amount': -1, 'unit': 'MINUTES'}],
  'validity': {'quantity': days, 'unit': 'DAY'},
};

void main() {
  test('structured provider data and 7/15/30 day validity remain exact', () {
    for (final days in [7, 15, 30]) {
      final details = BundlePresentation(MobileTopUpProduct.fromJson(offer(days: days)));
      expect(details.allowance, '7 GB');
      expect(details.bonus, '2GB Bonus Data');
      expect(details.validity, '$days days');
      expect(details.benefits, ['7 GB data', 'Unlimited MINUTES']);
    }
  });
  test('ambiguous, app-specific and mixed allowances never become invented data', () {
    for (final description in ['7GB + 2GB', "50GB D'Music - 50GB PlayGO",
      '2GB data - 4GB data', 'New unlimited promotional offer']) {
      final product = MobileTopUpProduct.fromJson({...offer(),
        'benefits': [], 'validity': null, 'description': description});
      final details = BundlePresentation(product);
      expect(details.allowance, isNull, reason: description);
      expect(details.validity, isNull);
      expect(details.description, description);
    }
  });
  test('Reloadly denomination name is the original provider description', () {
    const text = '7GB data - 2GB Bonus Data - Unlimited WhatsApp - 7 Days';
    final details = BundlePresentation(MobileTopUpProduct.fromJson({...offer(),
      'name': text, 'description': null, 'benefits': [], 'validity': null}));
    expect(details.allowance, '7GB');
    expect(details.bonus, '2GB Bonus Data');
    expect(details.validity, '7 Days');
    expect(details.description, text);
    expect(details.benefits, text.split(' - '));
  });
  test('complete provider clauses can be extracted without adding allowances', () {
    final details = BundlePresentation(MobileTopUpProduct.fromJson({...offer(),
      'benefits': [], 'validity': null,
      'description': "Unlimited on-net calls - 70GB any use Data - 50GB PlayGO - 30 DAY"}));
    expect(details.allowance, '70GB');
    expect(details.validity, '30 DAY');
  });
  for (final width in [320.0, 360.0, 412.0, 1024.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('readable full description at $width / text $scale', (t) async {
        t.view.physicalSize = Size(width, 1300);
        t.view.devicePixelRatio = 1;
        addTearDown(t.view.resetPhysicalSize);
        addTearDown(t.view.resetDevicePixelRatio);
        final p = MobileTopUpProduct.fromJson({...offer(), 'name': 'Long provider bundle name with calls and international data',
          'description': "Unlimited calls - 70GB any use Data - 50GB D'Music - 50GB PlayGO - 50GB SportsMax - 30 DAY"});
        var selected = false;
        await t.pumpWidget(shell(Builder(builder: (context) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
          child: Scaffold(body: SingleChildScrollView(child: Padding(
            padding: const EdgeInsets.all(16), child: InternetBundleCard(
              product: p, onSelected: () => selected = true))))))));
        await t.pumpAndSettle();
        await press(t, find.text('Plan details'));
        expect(find.text(p.description!), findsOneWidget);
        await press(t, find.text('Buy Now'));
        expect(selected, isTrue);
        expect(find.text(r'$5.35'), findsOneWidget);
        expect(t.takeException(), isNull);
      });
    }
  }
  testWidgets('Buy Now selects catalog ID and reviews actual price, fee and checkout', (t) async {
    final (adapter, _, j) = fixture();
    adapter.products..clear()..add(offer());
    await t.runAsync(() => loadProducts(j));
    j.internet = true;
    await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
    await t.pumpAndSettle();
    await press(t, find.text('Buy Now'));
    expect(j.product?.id, 'bundle-7');
    expect(j.step, RechargeStep.review);
    final request = adapter.requests.singleWhere((r) => r.path.endsWith('/quotes'));
    expect(request.data['productId'], 'bundle-7');
    expect(request.data['catalogVersion'], 'bundle-snapshot');
    // Server quote remains authoritative: the fixture deliberately returns 5,
    // not the card's 5.35. The UI must not calculate or override its fee/total.
    expect(j.quote?.providerAmount, 5);
    expect(j.quote?.feeUsd, 1.24);
    expect(j.quote?.totalChargeUsd, 6.24);
    expect(find.text('1.24 USD'), findsOneWidget);
    expect(find.text('6.24 USD'), findsOneWidget);
    expect(adapter.requests.where((r) => r.path.endsWith('/payment-sessions')), isEmpty);
    expect(t.takeException(), isNull);
  });
}
