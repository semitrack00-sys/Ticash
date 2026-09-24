import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'package:ticash/providers/mobile_top_up_provider.dart';
import 'package:ticash/screens/topup/mobile_top_up_screen.dart';
import 'package:ticash/services/mobile_top_up_service.dart';
import 'package:ticash/widgets/mobile_operator_logo.dart';

const _first = MobileTopUpOperator(
  id: 255,
  name: 'Carrier One',
  countryCode: 'JM',
  bundle: false,
  logoUrl: 'https://cdn.example.test/one.png',
);
const _second = MobileTopUpOperator(
  id: 1400000255,
  name: 'Carrier Two with a long readable operator name',
  countryCode: 'JM',
  bundle: false,
  logoUrl: 'https://cdn.example.test/two.png',
);

class _FakeRechargeService extends MobileTopUpService {
  _FakeRechargeService({this.manual = false}) : super(dio: Dio());
  final bool manual;
  @override
  Future<MobileTopUpAvailability> availability() async =>
      const MobileTopUpAvailability(
        enabled: true,
        environment: 'SANDBOX',
        testMode: true,
        productionEnabled: false,
        approvedForLiveUse: false,
        liveRechargeEnabled: false,
      );
  @override
  Future<List<MobileTopUpCountry>> countries() async => const [
    MobileTopUpCountry(code: 'JM', name: 'Jamaica'),
  ];
  @override
  Future<List<MobileTopUpRecipient>> recipients() async => const [];
  @override
  Future<MobileTopUpOperator> detectOperator({
    required String countryCode,
    required String phone,
  }) async {
    if (manual) throw StateError('Select manually');
    return _first;
  }

  @override
  Future<List<MobileTopUpOperator>> operators(String countryCode) async =>
      const [_first, _second];
  @override
  Future<List<MobileTopUpProduct>> products(
    String countryCode,
    int operatorId,
  ) async => const [
    MobileTopUpProduct(
      id: 'fixture-product',
      operatorId: 255,
      kind: MobileTopUpKind.airtime,
      name: 'Fixture airtime',
      price: 5,
      priceCurrency: 'USD',
      deliveredCurrency: 'JMD',
      amountType: 'FIXED',
    ),
  ];
  @override
  Future<MobileTopUpQuote> quote({
    required String countryCode,
    required String phone,
    required int operatorId,
    required String productId,
    double? amount,
  }) async => MobileTopUpQuote.fromJson({
    ..._terms,
    'id': 'fixture-quote',
    'expiresAt': '2099-01-01T00:00:00Z',
  });
  @override
  Future<MobileTopUpTransaction> purchase({
    required String quoteId,
    required String idempotencyKey,
    String? recipientId,
  }) async => MobileTopUpTransaction.fromJson({
    ..._terms,
    'id': 'fixture-receipt',
    'status': 'DELIVERED',
    'testMode': true,
    'createdAt': '2026-09-23T00:00:00Z',
  });
}

const _terms = <String, dynamic>{
  'recipientPhone': '+18765551234',
  'countryCode': 'JM',
  'operatorId': 255,
  'operatorName': 'Carrier One',
  'productId': 'fixture-product',
  'productName': 'Fixture airtime',
  'kind': 'AIRTIME',
  'providerAmount': 5,
  'providerCurrency': 'USD',
  'deliveredCurrency': 'JMD',
  'feeUsd': 3.5,
  'totalChargeUsd': 8.5,
};

void main() {
  testWidgets('missing logo renders a SIM fallback', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: MobileOperatorLogo())),
    );
    expect(find.byIcon(Icons.sim_card_outlined), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets(
    'failed network image falls back without throwing or hiding the name',
    (tester) async {
      // Flutter widget tests replace HttpClient with a 400 response: no real request.
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Row(
              children: [
                MobileOperatorLogo(
                  logoUrl: 'https://cdn.example.test/missing.png',
                ),
                Text('Carrier One'),
              ],
            ),
          ),
        ),
      );
      final image = tester.widget<Image>(find.byType(Image));
      expect(image.fit, BoxFit.contain);
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.sim_card_outlined), findsOneWidget);
      expect(find.text('Carrier One'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'retains the selected carrier logo in review and a mocked receipt',
    (tester) async {
      tester.view.physicalSize = const Size(500, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            mobileTopUpServiceProvider.overrideWithValue(
              _FakeRechargeService(),
            ),
          ],
          child: const MaterialApp(home: MobileTopUpScreen()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, '+18765551234');
      await tester.pump();
      await tester.tap(find.text('Detect operator'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Fixture airtime'));
      await tester.tap(find.text('Fixture airtime'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Review recharge'));
      await tester.tap(find.text('Review recharge'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Review'));
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is MobileOperatorLogo && widget.logoUrl == _first.logoUrl,
        ),
        findsWidgets,
      );
      expect(find.text('\$8.50 USD'), findsOneWidget);
      await tester.ensureVisible(find.text('Confirm sandbox recharge'));
      await tester.tap(find.text('Confirm sandbox recharge'));
      await tester.pumpAndSettle();
      expect(find.text('Recharge delivered'), findsOneWidget);
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is MobileOperatorLogo && widget.logoUrl == _first.logoUrl,
        ),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.sim_card_outlined), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  for (final manual in [false, true]) {
    testWidgets(
      'keeps carrier logo after ${manual ? 'manual selection' : 'auto detection'} and image failure',
      (tester) async {
        tester.view.physicalSize = const Size(500, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              mobileTopUpServiceProvider.overrideWithValue(
                _FakeRechargeService(manual: manual),
              ),
            ],
            child: const MaterialApp(home: MobileTopUpScreen()),
          ),
        );
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField).first, '+18765551234');
        await tester.pump();
        await tester.tap(find.text('Detect operator'));
        await tester.pumpAndSettle();
        expect(
          find.byWidgetPredicate(
            (widget) =>
                widget is MobileOperatorLogo &&
                widget.logoUrl == _first.logoUrl,
          ),
          findsWidgets,
        );
        if (manual) {
          await tester.tap(
            find.byType(DropdownButtonFormField<MobileTopUpOperator>),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text(_second.name).last);
          await tester.pumpAndSettle();
          expect(
            find.byWidgetPredicate(
              (widget) =>
                  widget is MobileOperatorLogo &&
                  widget.logoUrl == _second.logoUrl,
            ),
            findsWidgets,
          );
          expect(find.text(_second.name), findsWidgets);
        } else {
          expect(find.text(_first.name), findsOneWidget);
        }
        expect(find.byIcon(Icons.sim_card_outlined), findsWidgets);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
