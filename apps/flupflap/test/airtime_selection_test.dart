import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/recharge_journey.dart';
import 'package:flupflap/recharge_screen.dart';
import 'package:flupflap/parity_strings.dart';
import 'package:ticash/localization/app_localizations.dart';
import 'checkout_parity_test.dart' show fixture;
import 'parity_widget_test.dart' show shell, press;

const range = <String, dynamic>{
  'id': 'reloadly:HT:9:airtime:range',
  'operatorId': 9,
  'name': 'Digicel Haiti',
  'kind': 'AIRTIME',
  'price': 5,
  'priceCurrency': 'USD',
  'deliveredCurrency': 'HTG',
  'amountType': 'RANGE',
  'minimumAmount': 5,
  'maximumAmount': 100,
  'catalogVersion': 'provider-catalog-v1',
};

Future<void> loadProducts(RechargeJourney j) async {
  await j.initialize();
  j.destination(code: 'HT', number: '+50937000000');
  await j.continueDestination();
}

void main() {
  test(
    'one valid range airtime offer is selected without quoting or paying',
    () async {
      final (adapter, _, j) = fixture();
      adapter.products
        ..clear()
        ..add({...range});
      await loadProducts(j);
      expect(j.operator?.id, 9);
      expect(j.product, same(j.products.single));
      expect(j.product?.id, range['id']);
      expect(j.product?.catalogVersion, range['catalogVersion']);
      expect(j.amount, isEmpty);
      expect(j.canReview, isFalse);
      expect(adapter.quoteCount, 0);
      expect(
        adapter.requests.where((r) => r.path.endsWith('/payment-sessions')),
        isEmpty,
      );
    },
  );

  test(
    'manual operator selection also selects its single offer and clears the old amount',
    () async {
      final (adapter, _, j) = fixture();
      adapter.products
        ..clear()
        ..add({...range});
      await loadProducts(j);
      j.setAmount('10');
      adapter.products
        ..clear()
        ..add({...range, 'id': 'other-provider-product', 'operatorId': 10});
      await j.selectOperator(j.operators.last);
      expect(j.product?.id, 'other-provider-product');
      expect(j.product?.operatorId, 10);
      expect(j.amount, isEmpty);
      expect(j.canReview, isFalse);
    },
  );

  test(
    'invalid offers do not prevent selecting the sole valid product',
    () async {
      final (adapter, _, j) = fixture();
      adapter.products
        ..clear()
        ..addAll([
          {...range},
          {...range, 'id': 'missing-bounds', 'minimumAmount': null},
          {...range, 'id': 'inverted', 'minimumAmount': 101},
          {...range, 'id': 'wrong-operator', 'operatorId': 10},
          {...range, 'id': 'bad-increment', 'amountIncrement': 0},
          {...range, 'id': 'bad-precision', 'amountPrecision': 3},
          {...range, 'id': 'data-range', 'kind': 'DATA'},
        ]);
      await loadProducts(j);
      expect(j.products, hasLength(1));
      expect(j.product?.id, range['id']);
    },
  );

  test(
    'range limits, precision and increment gate both Continue and quote creation',
    () async {
      final (adapter, _, j) = fixture();
      adapter.products
        ..clear()
        ..add({...range, 'amountPrecision': 1, 'amountIncrement': 0.5});
      await loadProducts(j);
      for (final pair in [
        ('', RechargeAmountIssue.empty),
        ('4.99', RechargeAmountIssue.belowMinimum),
        ('100.01', RechargeAmountIssue.aboveMaximum),
        ('6.25', RechargeAmountIssue.precision),
        ('6.20', RechargeAmountIssue.increment),
        ('6.501', RechargeAmountIssue.invalid),
        ('NaN', RechargeAmountIssue.invalid),
      ]) {
        j.setAmount(pair.$1);
        expect(j.amountIssue, pair.$2, reason: pair.$1);
        expect(j.canReview, isFalse);
        await j.review();
      }
      expect(adapter.quoteCount, 0);
      for (final amount in ['5', '6.50', '100']) {
        j.setAmount(amount);
        expect(j.amountIssue, isNull);
        expect(j.canReview, isTrue);
      }
      await j.review();
      expect(
        adapter.requests.singleWhere((r) => r.path.endsWith('/quotes')).data,
        {
          'countryCode': 'HT',
          'phone': '+50937000000',
          'operatorId': 9,
          'productId': range['id'],
          'catalogVersion': range['catalogVersion'],
          'amount': 100.0,
        },
      );
      expect(j.quote?.feeUsd, 1.24);
      expect(j.quote?.totalChargeUsd, 6.24);
    },
  );

  testWidgets(
    'single range is highlighted, amount is immediate, and Continue follows min/max validation',
    (t) async {
      t.view.physicalSize = const Size(360, 900);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.resetPhysicalSize);
      addTearDown(t.view.resetDevicePixelRatio);
      final (adapter, _, j) = fixture();
      adapter.products
        ..clear()
        ..add({...range});
      await t.runAsync(j.initialize);
      await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
      await t.pumpAndSettle();
      j.destination(code: 'HT', number: '+50937000000');
      await t.pumpAndSettle();
      // Enter the step through its actual Destination Continue action.
      await t.enterText(
        find.byKey(const ValueKey('destination-phone')),
        '+50937000000',
      );
      await press(t, find.widgetWithText(FilledButton, 'Continue'));
      expect(j.step, RechargeStep.product);
      expect(j.product?.id, range['id']);
      final offer = find.widgetWithText(OutlinedButton, 'Digicel Haiti');
      expect(
        find.descendant(of: offer, matching: find.byIcon(Icons.check_circle)),
        findsOneWidget,
      );
      expect(
        t.widget<OutlinedButton>(offer).style!.backgroundColor!.resolve({}),
        const Color(0xFFE0EEFF),
      );
      final input = find.byKey(const ValueKey('range-amount'));
      expect(input, findsOneWidget);
      expect(t.getRect(input).top, greaterThan(t.getRect(offer).bottom));
      expect(t.getRect(input).bottom, lessThan(t.view.physicalSize.height));
      expect(t.widget<TextField>(input).controller!.text, isEmpty);
      expect(find.textContaining('Minimum: 5.0 USD'), findsOneWidget);
      final next = find.widgetWithText(FilledButton, 'Continue');
      expect(t.widget<FilledButton>(next).onPressed, isNull);
      expect(find.byType(Chip), findsNothing);
      for (final pair in [
        ('4.99', 'Minimum recharge amount: 5.00 USD.'),
        ('100.01', 'Maximum recharge amount: 100.00 USD.'),
      ]) {
        await t.enterText(input, pair.$1);
        await t.pumpAndSettle();
        expect(find.text(pair.$2), findsOneWidget);
        expect(t.widget<FilledButton>(next).onPressed, isNull);
      }
      for (final value in ['5', '100']) {
        await t.enterText(input, value);
        await t.pumpAndSettle();
        expect(t.widget<TextField>(input).decoration!.errorText, isNull);
        expect(t.widget<FilledButton>(next).onPressed, isNotNull);
      }
      await t.enterText(input, '');
      await t.pump();
      expect(t.widget<FilledButton>(next).onPressed, isNull);
      expect(adapter.quoteCount, 0);
      await t.enterText(input, '10');
      await press(t, next);
      expect(j.step, RechargeStep.review);
      expect(adapter.quoteCount, 1);
      await t.pumpWidget(const SizedBox());
      j.startAnother();
    },
  );

  for (final kind in ['AIRTIME', 'DATA']) {
    testWidgets(
      'multiple valid products including $kind require explicit selection',
      (t) async {
        final (adapter, _, j) = fixture();
        adapter.products
          ..clear()
          ..addAll([
            {...range},
            {
              ...range,
              'id': 'alternative',
              'name': 'Other offer',
              'kind': kind,
              'amountType': 'FIXED',
            },
          ]);
        await t.runAsync(() => loadProducts(j));
        await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
        await t.pumpAndSettle();
        expect(j.product, isNull);
        expect(find.byKey(const ValueKey('range-amount')), findsNothing);
        expect(
          t
              .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Continue'),
              )
              .onPressed,
          isNull,
        );
        await press(t, find.widgetWithText(OutlinedButton, 'Digicel Haiti'));
        expect(j.product?.id, range['id']);
        expect(find.byKey(const ValueKey('range-amount')), findsOneWidget);
        expect(j.canReview, isFalse);
        await t.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets(
    'single fixed airtime uses its provider amount without a manual field',
    (t) async {
      final (adapter, _, j) = fixture();
      adapter.products
        ..clear()
        ..add({...range, 'amountType': 'FIXED', 'id': 'fixed-provider-id'});
      await t.runAsync(() => loadProducts(j));
      await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
      await t.pumpAndSettle();
      expect(j.product?.id, 'fixed-provider-id');
      expect(find.byKey(const ValueKey('range-amount')), findsNothing);
      final next = find.widgetWithText(FilledButton, 'Continue');
      expect(t.widget<FilledButton>(next).onPressed, isNotNull);
      await press(t, next);
      final body =
          adapter.requests.singleWhere((r) => r.path.endsWith('/quotes')).data
              as Map;
      expect(body['productId'], 'fixed-provider-id');
      expect(body.containsKey('amount'), isFalse);
      expect(j.quote?.providerAmount, 5);
      await t.pumpWidget(const SizedBox());
      j.startAnother();
    },
  );

  testWidgets(
    'promotion preserves selected product and amount; validation is localized',
    (t) async {
      final (adapter, _, j) = fixture();
      adapter.products
        ..clear()
        ..add({...range});
      await t.runAsync(() => loadProducts(j));
      await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
      await t.pumpAndSettle();
      final input = find.byKey(const ValueKey('range-amount'));
      await t.enterText(input, '10');
      await t.enterText(
        find.byKey(const ValueKey('promotion-code')),
        'welcome',
      );
      await press(t, find.text('Apply'));
      expect(j.product?.id, range['id']);
      expect(j.amount, '10');
      expect(j.canReview, isTrue);
      expect(adapter.quoteCount, 0);
      await t.enterText(input, '4');
      for (final language in AppLanguage.values) {
        await t.pumpWidget(
          shell(RechargeJourneyScreen(journey: j), language: language),
        );
        await t.pumpAndSettle();
        expect(
          find.text(
            flupFlapStrings[language.code]!['amountTooLow']!.replaceAll(
              '{minimum}',
              '5.00 USD',
            ),
          ),
          findsOneWidget,
        );
        expect(j.canReview, isFalse);
      }
      await t.pumpWidget(const SizedBox());
    },
  );
}
