import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/session.dart';
import 'package:flupflap/store_seller_screen.dart';
import 'flupflap_test.dart' show FixtureAdapter, MemoryStorage;
import 'parity_widget_test.dart' show shell;

class StoreAdapter extends FixtureAdapter {
  Map<String, dynamic>? store;
  bool failFirstPurchase = false;
  int purchases = 0;
  final sale = <String, dynamic>{
    'id': 'sale-fixture',
    'recipientPhone': '+50937050210',
    'productName': 'Natcom airtime',
    'providerAmount': 10,
    'feeUsd': 1.5,
    'totalChargeUsd': 11.5,
    'operatorName': 'Natcom',
    'status': 'DELIVERED',
    'paymentStatus': 'CAPTURED',
  };
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    dynamic result;
    var status = 200;
    if (options.path == '/flupflap/stores') {
      result = {
        'store': store,
        'testMode': true,
        'canSell': store?['status'] == 'ACTIVE',
        'earnedCents': 0,
        'orders': [],
        'entries': [],
        'funding': [],
      };
    } else if (options.path.endsWith('/stores/application')) {
      store = {
        ...Map<String, dynamic>.from(options.data as Map),
        'status': 'PENDING',
        'balanceCents': 0,
        'commissionBps': 2000,
      };
      result = {'store': store};
    } else if (options.path.endsWith('/operators/detect')) {
      result = {
        'operator': {'id': 99},
      };
    } else if (options.path.endsWith('/99/products')) {
      result = {
        'products': [
          {
            'id': 'reloadly:HT:99:10',
            'name': 'Natcom airtime',
            'price': 10,
            'priceCurrency': 'USD',
            'deliveredCurrency': 'HTG',
            'kind': 'AIRTIME',
            'amountType': 'FIXED',
          },
        ],
      };
    } else if (options.path.endsWith('/stores/quotes')) {
      result = {
        'quote': {...sale, 'id': 'quote-fixture'},
      };
    } else if (options.path.endsWith('/stores/purchases')) {
      purchases++;
      status = failFirstPurchase && purchases == 1 ? 503 : 201;
      result = status == 503
          ? {'code': 'UPSTREAM_UNAVAILABLE'}
          : {'transaction': sale};
    } else {
      return super.fetch(options, stream, cancel);
    }
    requests.add(options);
    return ResponseBody.fromString(
      jsonEncode(result),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}

Future<(FlupFlapSession, StoreAdapter)> fixture({String? state}) async {
  final adapter = StoreAdapter();
  if (state != null) {
    adapter.store = {
      'name': 'Fixture Market',
      'status': state,
      'balanceCents': 10000,
      'commissionBps': 2000,
    };
  }
  final dio = Dio(BaseOptions(baseUrl: 'https://example.test/api'))
    ..httpClientAdapter = adapter;
  final session = FlupFlapSession(dio: dio, storage: MemoryStorage());
  await session.login('store@example.test', 'Fixture-password');
  return (session, adapter);
}

Future<void> tapText(WidgetTester tester, String text) async {
  final target = find.text(text);
  await tester.scrollUntilVisible(
    target,
    250,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'registered customer applies with business details but no role or balance',
    (tester) async {
      final (session, adapter) = (await tester.runAsync(() => fixture()))!;
      await tester.pumpWidget(
        shell(StoreSellerScreen(session: session)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Sell FlupFlap Recharge in your store'), findsOneWidget);
      final values = [
        'Fixture Market',
        'Fixture Owner',
        '+17755550123',
        '123 Fixture Street, Reno',
      ];
      for (var i = 0; i < values.length; i++) {
        await tester.enterText(find.byType(TextFormField).at(i), values[i]);
      }
      tester.testTextInput.hide();
      await tester.pumpAndSettle();
      await tapText(tester, 'Apply for store account');
      expect(find.text('Status: PENDING'), findsOneWidget);
      final request = adapter.requests.firstWhere(
        (r) => r.path.endsWith('/stores/application'),
      );
      expect((request.data as Map).keys.toSet(), {
        'name',
        'contactName',
        'phone',
        'address',
        'country',
      });
      expect(find.text('Send using store balance'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      session.dispose();
    },
  );
  testWidgets('suspended store cannot send recharges or submit deposits', (
    tester,
  ) async {
    final (session, _) = (await tester.runAsync(
      () => fixture(state: 'SUSPENDED'),
    ))!;
    await tester.pumpWidget(
      shell(StoreSellerScreen(session: session)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Status: SUSPENDED'), findsOneWidget);
    expect(find.text('Find airtime and internet plans'), findsNothing);
    expect(find.text('Submit deposit for verification'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    session.dispose();
  });
  testWidgets(
    'seller reviews the total and retries an uncertain sale with the same key',
    (tester) async {
      final (session, adapter) = (await tester.runAsync(
        () => fixture(state: 'ACTIVE'),
      ))!;
      adapter.failFirstPurchase = true;
      await tester.pumpWidget(
        shell(StoreSellerScreen(session: session)),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.widgetWithText(TextFormField, 'Family member’s phone number'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Family member’s phone number'),
        '+50937050210',
      );
      await tapText(tester, 'Find airtime and internet plans');
      await tapText(tester, 'Buy Now');
      await tapText(tester, 'Review customer price');
      await tester.scrollUntilVisible(
        find.text('Customer total: \$11.50 USD'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Customer total: \$11.50 USD'), findsOneWidget);
      await tapText(tester, 'Send using store balance');
      expect(find.text('Change recharge'), findsNothing);
      await tapText(tester, 'Check / retry this same sale');
      expect(adapter.purchases, 2);
      final attempts = adapter.requests
          .where((r) => r.path.endsWith('/stores/purchases'))
          .toList();
      expect(attempts.map((r) => r.headers['Idempotency-Key']).toSet(), {
        'store:quote-fixture',
      });
      expect(find.text('Receipt: sale-fixture'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      session.dispose();
    },
  );
}
