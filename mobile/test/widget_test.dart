import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash_mobile/main.dart';
import 'package:ticash_mobile/models/mobile_topup.dart';
import 'package:ticash_mobile/providers/mobile_topup_provider.dart';
import 'package:ticash_mobile/services/mobile_topup_service.dart';

class FakeMobileTopUpService implements MobileTopUpService {
  final detectCalls = <String>[];
  final operatorCalls = <String>[];
  final productCalls = <String>[];
  final quoteRequests = <Map<String, dynamic>>[];

  final countriesValue = const [
    MobileTopUpCountry(code: 'HT', name: 'Haiti'),
    MobileTopUpCountry(code: 'JM', name: 'Jamaica'),
  ];

  final haitiOperator = const MobileTopUpOperator(
    id: 99,
    name: 'Provider Haiti Sandbox',
    countryCode: 'HT',
    destinationCurrencyCode: 'HTG',
  );

  final jamaicaOperator = const MobileTopUpOperator(
    id: 77,
    name: 'Provider Jamaica Sandbox',
    countryCode: 'JM',
    destinationCurrencyCode: 'JMD',
  );

  final savedRecipientsValue = const [
    MobileTopUpRecipient(
      id: 'recipient-1',
      nickname: 'Mom',
      phone: '+50937123456',
      countryCode: 'HT',
      operatorId: 99,
      operatorName: 'Provider Haiti Sandbox',
      lastProductId: 'reloadly:HT:99:data:10.00',
      lastProductName: 'Haiti Data 10',
    ),
  ];

  final historyValue = [
    MobileTopUpTransaction(
      id: 'txn-old',
      countryCode: 'HT',
      recipientPhone: '+50937123456',
      operatorName: 'Provider Haiti Sandbox',
      productName: 'Haiti Data 10',
      status: 'DELIVERED',
      totalChargeUsd: 11.05,
      createdAt: DateTime(2026, 1, 1),
    ),
  ];

  @override
  Future<List<MobileTopUpCountry>> countries() async => countriesValue;

  @override
  Future<MobileTopUpOperator> detectOperator(String countryCode, String phone) async {
    detectCalls.add('$countryCode|$phone');
    return countryCode == 'JM' ? jamaicaOperator : haitiOperator;
  }

  @override
  Future<List<MobileTopUpTransaction>> history() async => historyValue;

  @override
  Future<List<MobileTopUpOperator>> operators(String countryCode) async {
    operatorCalls.add(countryCode);
    return [countryCode == 'JM' ? jamaicaOperator : haitiOperator];
  }

  @override
  Future<MobileTopUpTransaction> purchase({
    required String quoteId,
    String? recipientId,
  }) async {
    return MobileTopUpTransaction(
      id: 'txn-new',
      countryCode: quoteId.contains('jm') ? 'JM' : 'HT',
      recipientPhone: quoteId.contains('jm') ? '+18765551234' : '+50937123456',
      operatorName: quoteId.contains('jm')
          ? jamaicaOperator.name
          : haitiOperator.name,
      productName: quoteId.contains('jm') ? 'Jamaica Airtime 5.00' : 'Haiti Data 10',
      status: 'PROCESSING',
      totalChargeUsd: quoteId.contains('jm') ? 5.99 : 11.05,
      createdAt: DateTime(2026, 1, 2),
    );
  }

  @override
  Future<MobileTopUpQuote> quote({
    required String countryCode,
    required String phone,
    required int operatorId,
    required String productId,
    double? amount,
  }) async {
    quoteRequests.add({
      'countryCode': countryCode,
      'phone': phone,
      'operatorId': operatorId,
      'productId': productId,
    });
    return MobileTopUpQuote(
      id: countryCode == 'JM' ? 'quote-jm' : 'quote-ht',
      countryCode: countryCode,
      recipientPhone: phone,
      operatorId: operatorId,
      operatorName: countryCode == 'JM' ? jamaicaOperator.name : haitiOperator.name,
      productId: productId,
        productName:
          countryCode == 'JM' ? 'Jamaica Airtime 5.00' : 'Haiti Data 10',
        providerAmount: countryCode == 'JM' ? 5 : 10,
      providerCurrency: 'USD',
      deliveredCurrency: countryCode == 'JM' ? 'JMD' : 'HTG',
        feeUsd: countryCode == 'JM' ? 0.99 : 1.05,
        totalChargeUsd: countryCode == 'JM' ? 5.99 : 11.05,
      expiresAt: DateTime(2026, 1, 2),
        deliveredValue: countryCode == 'JM' ? 800 : 1300,
    );
  }

  @override
  Future<List<MobileTopUpRecipient>> recipients() async => savedRecipientsValue;

  @override
  Future<MobileTopUpRecipient> saveRecipient({
    required String countryCode,
    required String nickname,
    required String phone,
    int? operatorId,
    String? operatorName,
  }) async {
    return MobileTopUpRecipient(
      id: 'saved',
      nickname: nickname,
      phone: phone,
      countryCode: countryCode,
      operatorId: operatorId,
      operatorName: operatorName,
    );
  }

  @override
  Future<List<MobileTopUpProduct>> products(String countryCode, int operatorId) async {
    productCalls.add('$countryCode|$operatorId');
    if (countryCode == 'JM') {
      return const [
        MobileTopUpProduct(
          id: 'reloadly:JM:77:airtime:5.00',
          countryCode: 'JM',
          operatorId: 77,
          kind: MobileTopUpProductKind.airtime,
          name: 'Jamaica Airtime 5.00',
          price: 5,
          priceCurrency: 'USD',
          deliveredCurrency: 'JMD',
          amountType: MobileTopUpAmountType.fixed,
          deliveredValue: 800,
        ),
      ];
    }
    return const [
      MobileTopUpProduct(
        id: 'reloadly:HT:99:data:10.00',
        countryCode: 'HT',
        operatorId: 99,
        kind: MobileTopUpProductKind.data,
        name: 'Haiti Data 10',
        price: 10,
        priceCurrency: 'USD',
        deliveredCurrency: 'HTG',
        amountType: MobileTopUpAmountType.fixed,
        deliveredValue: 1300,
      ),
    ];
  }
}

class DelayedDetectFailureService extends FakeMobileTopUpService {
  final detectCompleter = Completer<MobileTopUpOperator>();

  @override
  Future<MobileTopUpOperator> detectOperator(String countryCode, String phone) {
    detectCalls.add('$countryCode|$phone');
    return detectCompleter.future;
  }
}

Future<void> _openRecharge(
  WidgetTester tester,
  FakeMobileTopUpService service,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        mobileTopUpServiceProvider.overrideWithValue(service),
      ],
      child: const TicashApp(),
    ),
  );
  await tester.pump(const Duration(milliseconds: 300));
  await tester.tap(find.text('Send money').first);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Open mobile recharge'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Home screen still shows greeting, balance and quick actions',
      (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: TicashApp()));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Your money, ready when you are.'), findsOneWidget);
    expect(find.textContaining('2,485.60'), findsOneWidget);
    expect(find.text('Send money'), findsWidgets);
    expect(find.text('Add money'), findsOneWidget);
    expect(find.text('My QR'), findsOneWidget);
    expect(find.text('Recent activity'), findsOneWidget);
  });

  testWidgets(
      'mobile recharge screen loads countries, supports searchable selection, detection, quotes, receipts and sandbox warning',
      (WidgetTester tester) async {
    final service = FakeMobileTopUpService();
    await _openRecharge(tester, service);

    expect(find.text('Sandbox only • USD billing'), findsOneWidget);
    expect(find.text('Haiti (HT)'), findsOneWidget);

    await tester.tap(find.text('Haiti (HT)'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Jam');
    await tester.pump();
    await tester.tap(find.text('Jamaica'));
    await tester.pumpAndSettle();
    expect(find.text('Jamaica (JM)'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'International mobile number'),
      '+1 876 555 1234',
    );
    await tester.tap(find.text('Detect operator'));
    await tester.pumpAndSettle();

    expect(service.detectCalls, contains('JM|+1 876 555 1234'));
    expect(find.text('Provider Jamaica Sandbox'), findsOneWidget);
    expect(service.productCalls, contains('JM|77'));
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('product-reloadly:JM:77:airtime:5.00')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const ValueKey('product-reloadly:JM:77:airtime:5.00')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Get quote'));
    await tester.pumpAndSettle();
    expect(service.quoteRequests.single['countryCode'], 'JM');
    expect(find.text('Review'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Confirm recharge'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Confirm recharge'));
    await tester.pumpAndSettle();
    expect(find.text('Receipt'), findsOneWidget);
    expect(find.text('Status: PROCESSING'), findsOneWidget);
    expect(find.text('Recent recharge history'), findsOneWidget);
  });

  testWidgets('changing country clears stale operator, quote and receipt state',
      (WidgetTester tester) async {
    final service = FakeMobileTopUpService();
    await _openRecharge(tester, service);

    await tester.tap(find.text('Haiti (HT)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Jamaica'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'International mobile number'),
      '+1 876 555 1234',
    );
    await tester.tap(find.text('Detect operator'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('product-reloadly:JM:77:airtime:5.00')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const ValueKey('product-reloadly:JM:77:airtime:5.00')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Get quote'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Confirm recharge'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Confirm recharge'));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Jamaica (JM)'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Jamaica (JM)'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Haiti'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Haiti'));
    await tester.pumpAndSettle();

    expect(find.text('Review'), findsNothing);
    expect(find.text('Receipt'), findsNothing);
    expect(find.text('Status: PROCESSING'), findsNothing);
  });

  testWidgets('editing the phone clears stale operator, product and quote state',
      (WidgetTester tester) async {
    final service = FakeMobileTopUpService();
    await _openRecharge(tester, service);

    await tester.tap(find.text('Haiti (HT)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Jamaica'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'International mobile number'),
      '+1 876 555 1234',
    );
    await tester.tap(find.text('Detect operator'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('product-reloadly:JM:77:airtime:5.00')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const ValueKey('product-reloadly:JM:77:airtime:5.00')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Get quote'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextField, 'International mobile number'),
      '+1 876 555 9999',
    );
    await tester.pumpAndSettle();

    expect(find.text('Provider Jamaica Sandbox'), findsNothing);
    expect(find.text('Jamaica Airtime 5.00\nUSD 5.00'), findsNothing);
    expect(find.text('Review'), findsNothing);
  });

  testWidgets('saved recipients restore country and reload provider data',
      (WidgetTester tester) async {
    final service = FakeMobileTopUpService();
    await _openRecharge(tester, service);

    await tester.tap(find.text('Mom • HT'));
    await tester.pumpAndSettle();

    expect(find.text('Haiti (HT)'), findsOneWidget);
    expect(find.text('+50937123456'), findsOneWidget);
    expect(service.operatorCalls, contains('HT'));
    expect(service.productCalls, contains('HT|99'));
    expect(find.text('Provider Haiti Sandbox'), findsOneWidget);
  });

  testWidgets('stale detect failures do not overwrite newer phone input state',
      (WidgetTester tester) async {
    final service = DelayedDetectFailureService();
    await _openRecharge(tester, service);

    await tester.tap(find.text('Haiti (HT)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Jamaica'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'International mobile number'),
      '+1 876 555 1234',
    );
    await tester.tap(find.text('Detect operator'));
    await tester.pump();

    await tester.enterText(
      find.widgetWithText(TextField, 'International mobile number'),
      '+1 876 555 9999',
    );
    service.detectCompleter.completeError(Exception('stale detect failure'));
    await tester.pumpAndSettle();

    expect(find.textContaining('stale detect failure'), findsNothing);
    expect(find.text('Provider Jamaica Sandbox'), findsNothing);
  });
}
