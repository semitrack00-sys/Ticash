import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/checkout_contract.dart';
import 'package:flupflap/recharge_design.dart';
import 'package:flupflap/recharge_journey.dart';
import 'package:flupflap/recharge_screen.dart';

import 'checkout_parity_test.dart' show ParityAdapter;
import 'parity_widget_test.dart' show shell, press, capture;

// Provider fixtures deliberately differ in country, currency, limits and fees.
// Non-USD provider amounts are NOT summed with USD fees in the client.
class CountryCatalog extends ParityAdapter {
  CountryCatalog(this.country, this.currency, {this.bundles = false});
  final String country, currency;
  final bool bundles;
  Completer<void>? quoteGate, quoteStarted;
  bool failQuote = false;
  int feeCents = 83;
  Map<String, dynamic> get carrier => {
    'id': 91,
    'name': '$country carrier',
    'countryCode': country,
    'bundle': bundles,
  };
  Map<String, dynamic> get offer => {
    'id': '$country-offer',
    'operatorId': 91,
    'name': bundles ? 'Regional data plan' : '$country carrier',
    'kind': bundles ? 'BUNDLE' : 'AIRTIME',
    'price': 8,
    'priceCurrency': currency,
    'deliveredCurrency': currency,
    'amountType': bundles ? 'FIXED' : 'RANGE',
    if (!bundles) ...{
      'minimumAmount': 2,
      'maximumAmount': 850,
      'amountIncrement': .5,
    },
    'catalogVersion': '$country-catalog-v3',
    if (bundles) ...{
      'benefits': [
        {'type': 'DATA', 'amount': 3, 'unit': 'GB'},
      ],
      'validity': {'quantity': 14, 'unit': 'DAY'},
    },
  };
  @override
  Future<ResponseBody> fetch(
    RequestOptions o,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    Object? data;
    if (o.path.endsWith('/countries')) {
      data = {
        'countries': [
          {'code': country, 'name': country},
        ],
      };
    } else if (o.path.endsWith('/operators/detect')) {
      data = {'operator': carrier};
    } else if (o.path.endsWith('/operators')) {
      data = {
        'operators': [carrier],
      };
    } else if (o.path.endsWith('/products')) {
      data = {
        'products': [offer],
      };
    } else if (o.path.endsWith('/quotes')) {
      final body = Map<String, dynamic>.from(o.data as Map);
      requests.add(o);
      quoteCount++;
      if (quoteStarted?.isCompleted == false) quoteStarted!.complete();
      final fee = feeCents;
      await quoteGate?.future;
      if (failQuote) {
        throw DioException(
          requestOptions: o,
          type: DioExceptionType.connectionError,
        );
      }
      return ResponseBody.fromString(
        jsonEncode({
          'quote': {
            ...quote(body),
            'kind': bundles ? 'BUNDLE' : 'AIRTIME',
            'providerAmount': body['amount'] ?? 8,
            'providerCurrency': currency,
            'deliveredCurrency': currency,
            'feeUsd': fee / 100,
            'totalChargeUsd': 9.75 + fee / 100,
          },
        }),
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    if (data == null) return super.fetch(o, stream, cancel);
    requests.add(o);
    return ResponseBody.fromString(
      jsonEncode(data),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}

Future<RechargeJourney> catalog(CountryCatalog adapter) async {
  final j = RechargeJourney(
    FlupFlapClient(
      Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
        ..httpClientAdapter = adapter,
    ),
    guest: () => false,
    storedBillingCountry: () => 'US',
  );
  await j.initialize();
  if (adapter.bundles) j.selectService(true);
  j.destination(code: adapter.country, number: '+15551234567');
  await j.continueDestination();
  return j;
}

void main() {
  setUpAll(() async {
    final root = Platform.environment['FLUTTER_ROOT'];
    if (Platform.environment['FLUPFLAP_SCREENSHOT_DIR'] == null ||
        root == null) {
      return;
    }
    for (final entry in {
      'Roboto': 'Roboto-Regular.ttf',
      'MaterialIcons': 'MaterialIcons-Regular.otf',
    }.entries) {
      var file = File(
        '$root/bin/cache/artifacts/material_fonts/${entry.value}',
      );
      if (!await file.exists() && entry.key == 'MaterialIcons') {
        file = File(
          '$root/bin/cache/artifacts/material_fonts/materialicons-regular.otf',
        );
      }
      await (FontLoader(entry.key)..addFont(
            Future.value(ByteData.sublistView(await file.readAsBytes())),
          ))
          .load();
    }
  });
  for (final pair in [
    ('US', 'USD'),
    ('FR', 'EUR'),
    ('BR', 'BRL'),
    ('CA', 'CAD'),
    ('JM', 'JMD'),
  ]) {
    for (final bundles in [false, true]) {
      testWidgets(
        'approved layout ${pair.$1} ${pair.$2} bundles=$bundles uses server prices',
        (t) async {
          t.view.physicalSize = const Size(430, 1000);
          t.view.devicePixelRatio = 1;
          addTearDown(t.view.resetPhysicalSize);
          addTearDown(t.view.resetDevicePixelRatio);
          final a = CountryCatalog(pair.$1, pair.$2, bundles: bundles);
          late RechargeJourney j;
          await t.runAsync(() async => j = await catalog(a));
          addTearDown(j.dispose);
          await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
          await t.pumpAndSettle();
          expect(
            t.widget<AppBar>(find.byType(AppBar)).backgroundColor,
            RechargeDesign.navy,
          );
          expect(find.text('Operator & Product'), findsOneWidget);
          expect(
            find.text('${pair.$1} carrier'),
            findsOneWidget,
          ); // no repeated operator row
          expect(find.byKey(const ValueKey('promotion-code')), findsNothing);
          expect(find.byType(RechargeServiceTabs), findsOneWidget);
          final airtimeTab = find.byKey(
            const ValueKey('recharge-service-false'),
          );
          final bundleTab = find.byKey(const ValueKey('recharge-service-true'));
          expect(
            t.getSize(airtimeTab).width,
            closeTo(t.getSize(bundleTab).width, .1),
          );
          expect(
            t.getSize(airtimeTab).height,
            closeTo(t.getSize(bundleTab).height, .1),
          );
          expect(t.getSize(airtimeTab).width, greaterThan(190));
          if (bundles) {
            await press(t, find.byKey(ValueKey('bundle-buy-${pair.$1}-offer')));
            expect(find.byKey(const ValueKey('range-amount')), findsNothing);
            expect(find.text('3 GB Data'), findsOneWidget);
          } else {
            expect(
              find.text(
                'Minimum: ${RechargeDesign.symbol(pair.$2)}${pair.$2 == 'USD' || pair.$2 == 'EUR' ? '' : ' '}2',
              ),
              findsOneWidget,
            );
            await t.enterText(find.byKey(const ValueKey('range-amount')), '8');
          }
          if (!bundles) {
            final rangeCard = find.byKey(
              ValueKey('bundle-card-${pair.$1}-offer'),
            );
            final minimum = find.text(
              'Minimum: ${RechargeDesign.limit(2, pair.$2)}',
            );
            expect(
              t.getRect(minimum).left,
              greaterThan(t.getRect(rangeCard).center.dx),
            );
            expect(
              t
                  .widget<TextField>(find.byKey(const ValueKey('range-amount')))
                  .decoration!
                  .suffixIcon,
              isNotNull,
            );
          }
          await t.pump(const Duration(milliseconds: 450));
          await t.pumpAndSettle();
          expect(find.text(RechargeDesign.money(8, pair.$2)), findsOneWidget);
          expect(find.text('\$0.83 USD'), findsOneWidget);
          expect(find.text('\$10.58 USD'), findsOneWidget);
          expect(
            a.requests.where((r) => r.path.endsWith('/payment-sessions')),
            isEmpty,
          );
          await t.runAsync(
            () => precacheImage(
              const AssetImage('assets/flupflap-mark.png'),
              t.element(find.byType(AppBar)),
            ),
          );
          await t.pumpAndSettle();
          await capture(
            t,
            'approved-${pair.$1}-${bundles ? 'bundles' : 'airtime'}',
          );
          final next = find.byKey(const ValueKey('continue-to-payment'));
          expect(find.byType(FilledButton), findsOneWidget);
          await t.ensureVisible(next);
          expect(t.getSize(next).width, closeTo(398, 1));
          await press(t, next);
          expect(j.step, RechargeStep.review);
          expect(
            a.quoteCount,
            1,
          ); // same displayed quote proceeds to existing confirmation
          expect(j.reviewed, isFalse);
          expect(j.canPay, isFalse);
          expect(t.takeException(), isNull);
          await t.pumpWidget(const SizedBox());
          j.startAnother();
        },
      );
    }
  }

  test(
    'edits discard delayed quotes and promotions require a fresh server total',
    () async {
      final a = CountryCatalog('CA', 'CAD');
      final j = await catalog(a);
      addTearDown(j.dispose);
      j.setAmount('8');
      final gate = a.quoteGate = Completer<void>();
      final old = j.previewQuote();
      j.setAmount('20');
      a.quoteGate = null;
      a.feeCents = 177;
      await j.previewQuote();
      expect(j.quote!.providerAmount, 20);
      expect(j.quote!.feeUsd, 1.77);
      gate.complete();
      await old;
      expect(j.quote!.providerAmount, 20);
      expect(j.quote!.feeUsd, 1.77);
      await j.applyPromotion('welcome');
      expect(j.quote, isNull);
      expect(j.amount, '20');
      a.feeCents = 24;
      await j.previewQuote();
      expect(j.quote!.feeUsd, .24);
      await j.review();
      expect(j.quote!.feeUsd, .24);
      expect(j.reviewed, isFalse);
      expect(
        a.requests.where((r) => r.path.endsWith('/payment-sessions')),
        isEmpty,
      );
    },
  );

  test(
    'a failed preview is retried by Continue without creating a payment',
    () async {
      final a = CountryCatalog('BR', 'BRL');
      final j = await catalog(a);
      addTearDown(j.dispose);
      j.setAmount('8');
      a.failQuote = true;
      await j.previewQuote();
      expect(j.quote, isNull);
      expect(j.previewError, 'requestFailed');
      a.failQuote = false;
      await j.review();
      expect(j.step, RechargeStep.review);
      expect(j.quote!.feeUsd, .83);
      expect(j.canPay, isFalse);
    },
  );

  for (final width in [320.0, 360.0, 430.0, 1024.0]) {
    for (final scale in [1.0, 2.0]) {
      for (final bundles in [false, true]) {
        testWidgets(
          'products and totals fit $width scale $scale bundles=$bundles',
          (t) async {
            t.view.physicalSize = Size(width, 1100);
            t.view.devicePixelRatio = 1;
            addTearDown(t.view.resetPhysicalSize);
            addTearDown(t.view.resetDevicePixelRatio);
            final a = CountryCatalog('BR', 'BRL', bundles: bundles);
            late RechargeJourney j;
            await t.runAsync(() async => j = await catalog(a));
            addTearDown(j.dispose);
            await t.pumpWidget(
              shell(
                MediaQuery(
                  data: MediaQueryData(
                    size: Size(width, 1100),
                    textScaler: TextScaler.linear(scale),
                  ),
                  child: RechargeJourneyScreen(journey: j),
                ),
              ),
            );
            await t.pumpAndSettle();
            if (bundles) {
              await press(t, find.byKey(const ValueKey('bundle-buy-BR-offer')));
            } else {
              await t.enterText(
                find.byKey(const ValueKey('range-amount')),
                '8',
              );
            }
            await t.pump(const Duration(milliseconds: 450));
            await t.pumpAndSettle();
            await t.ensureVisible(
              find.byKey(const ValueKey('continue-to-payment')),
            );
            expect(t.takeException(), isNull);
            final summary = find.byKey(
              const ValueKey('recharge-price-summary'),
            );
            expect(t.getRect(summary).width, lessThanOrEqualTo(width));
            await t.pumpWidget(const SizedBox());
            j.startAnother();
          },
        );
      }
    }
  }
}
