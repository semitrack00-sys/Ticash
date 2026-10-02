import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:flupflap/main.dart';
import 'package:flupflap/session.dart';
import 'flupflap_test.dart' show FixtureAdapter, MemoryStorage;

// These fixtures never participate in a production build or contact a provider.
const recipient = {
  'id': 'recipient-fixture',
  'nickname': 'Family with a very long recipient name',
  'phone': '+15551234567',
  'countryCode': 'US',
};
const terms = {
  'countryCode': 'US',
  'recipientPhone': '+15551234567',
  'operatorId': 255,
  'operatorName': 'A carrier with a very long international name',
  'productId': 'fixture-product',
  'productName': 'A supported product with a long descriptive name',
  'kind': 'AIRTIME',
  'providerAmount': 5,
  'providerCurrency': 'USD',
  'deliveredValue': 5,
  'deliveredCurrency': 'USD',
  'feeUsd': 1.24,
  'totalChargeUsd': 6.24,
};

class CatalogAdapter extends FixtureAdapter {
  String transactionStatus = 'PENDING';
  bool unavailable = false, includeHistory = false;
  final saved = <Map<String, dynamic>>[
    {...recipient},
  ];
  Map<String, dynamic> get transaction => {
    ...terms,
    'id': 'transaction-fixture',
    'status': transactionStatus,
    'paymentStatus': transactionStatus == 'DELIVERED'
        ? 'CAPTURED'
        : transactionStatus == 'REFUNDED'
        ? 'REFUNDED'
        : transactionStatus == 'FAILED'
        ? 'FAILED'
        : 'AUTHORIZED',
    'testMode': true,
    'createdAt': '2026-09-30T12:00:00Z',
  };
  @override
  Future<ResponseBody> fetch(
    RequestOptions o,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    if (o.path.startsWith('/flupflap/marketing/quotes/')) {
      return ResponseBody.fromString(
        '{"promotion":null}',
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    if (!o.path.startsWith('/flupflap/mobile-topups/')) {
      return super.fetch(o, stream, cancel);
    }
    requests.add(o);
    Object data;
    if (unavailable) {
      return ResponseBody.fromString(
        '{"error":"Catalog unavailable"}',
        503,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    if (o.path.endsWith('/status')) {
      data = {
        'enabled': true,
        'paymentMode': 'MOCK',
        'environment': 'SANDBOX',
        'testMode': true,
        'productionEnabled': false,
        'approvedForLiveUse': false,
        'liveRechargeEnabled': false,
        'providers': ['RELOADLY', 'DING'],
      };
    } else if (o.path.endsWith('/payment-methods')) {
      data = {
        'environment': 'SANDBOX',
        'methods': [
          {
            'type': 'CARD',
            'provider': 'MOCK',
            'enabled': true,
            'testMode': true,
          },
        ],
      };
    } else if (o.path.endsWith('/operators')) {
      data = {
        'operators': [
          {
            'id': 255,
            'name': terms['operatorName'],
            'countryCode': 'US',
            'bundle': false,
          },
        ],
      };
    } else if (o.path.endsWith('/countries')) {
      data = {
        'countries': [
          {
            'code': 'US',
            'name': 'United States with a long country display name',
          },
          {'code': 'HT', 'name': 'Haiti'},
        ],
      };
    } else if (o.path.endsWith('/recipients')) {
      if (o.method == 'POST') {
        final item = {'id': 'new-recipient', ...o.data as Map<String, dynamic>};
        saved.add(item);
        data = {'recipient': item};
      } else {
        data = {'recipients': saved};
      }
    } else if (o.path.endsWith('/operators/detect')) {
      data = {
        'operator': {
          'id': 255,
          'name': terms['operatorName'],
          'countryCode': 'US',
          'bundle': false,
          'provider': 'RELOADLY',
        },
      };
    } else if (o.path.endsWith('/products')) {
      data = {
        'products': [
          {
            'id': 'fixture-product',
            'operatorId': 255,
            'name': terms['productName'],
            'kind': 'AIRTIME',
            'price': 5,
            'priceCurrency': 'USD',
            'deliveredCurrency': 'USD',
            'amountType': 'FIXED',
          },
        ],
      };
    } else if (o.path.endsWith('/quotes') || o.path.endsWith('/repeat')) {
      data = {
        'quote': {
          ...terms,
          'id': 'quote-fixture',
          'expiresAt': '2099-01-01T00:00:00Z',
        },
      };
    } else if (o.path.endsWith('/transactions') && o.method == 'GET') {
      data = {
        'transactions': includeHistory ? [transaction] : [],
      };
    } else {
      data = {'transaction': transaction};
    }
    return ResponseBody.fromString(
      jsonEncode(data),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}

Future<(FlupFlapSession, CatalogAdapter)> app(
  WidgetTester tester,
  double width, {
  bool guest = false,
  double scale = 1,
  String? status,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 900);
  tester.platformDispatcher.textScaleFactorTestValue = scale;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  final adapter = CatalogAdapter()
    ..transactionStatus = (status ?? 'PENDING')
    ..includeHistory = status != null;
  final session = FlupFlapSession(
    dio: Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
      ..httpClientAdapter = adapter,
    storage: MemoryStorage(),
  );
  await session.initialize();
  await tester.runAsync(
    () => guest
        ? session.enterGuest()
        : session.login('customer@example.test', 'test-password'),
  );
  await tester.pumpWidget(FlupFlapApp(session: session));
  await tester.pumpAndSettle();
  return (session, adapter);
}

Future<void> tap(WidgetTester tester, Finder finder) async {
  if (finder.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      finder,
      200,
      scrollable: find
          .byWidgetPredicate(
            (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
          )
          .last,
    );
  }
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> screenshot(WidgetTester tester, String name) async {
  final directory = Platform.environment['FLUPFLAP_SCREENSHOT_DIR'];
  if (directory == null) return;
  final boundary = tester.allRenderObjects
      .whereType<RenderRepaintBoundary>()
      .firstWhere((r) => r.size == tester.view.physicalSize);
  await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await Directory(directory).create(recursive: true);
    await File(
      '$directory/$name.png',
    ).writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  setUpAll(() async {
    final font = Platform.environment['FLUPFLAP_TEST_FONT'];
    if (font != null) {
      for (final family in ['Roboto']) {
        await (FontLoader(family)..addFont(
              Future.value(ByteData.sublistView(File(font).readAsBytesSync())),
            ))
            .load();
      }
      final icons = File('${File(font).parent.path}/materialicons-regular.otf');
      await (FontLoader('MaterialIcons')..addFont(
            Future.value(ByteData.sublistView(icons.readAsBytesSync())),
          ))
          .load();
    }
  });
  for (final width in [360.0, 375.0, 390.0, 412.0, 430.0, 768.0]) {
    for (final scale in [1.0, 1.5]) {
      testWidgets('navigation and catalog fit width=$width scale=$scale', (
        tester,
      ) async {
        final (_, adapter) = await app(tester, width, scale: scale);
        if (scale == 1) await screenshot(tester, 'home-${width.toInt()}');
        for (final name in [
          'Recharge',
          'History',
          'Recipients',
          'Account',
          'Home',
        ]) {
          await tap(tester, find.widgetWithText(NavigationDestination, name));
          expect(
            tester.takeException(),
            isNull,
            reason: '$name at $width / $scale',
          );
          if (name == 'Recharge') {
            expect(find.textContaining('Reloadly destination'), findsNothing);
            expect(find.text('Recharge provider'), findsNothing);
            if (scale == 1) {
              await screenshot(tester, 'recharge-${width.toInt()}');
            }
          }
          if (name == 'Account') {
            expect(find.text('Sign out').hitTestable(), findsOneWidget);
          }
        }
        await tap(
          tester,
          find.widgetWithText(NavigationDestination, 'Account'),
        );
        await tap(tester, find.text('Sign out'));
        expect(find.text('Sign in to FlupFlap'), findsOneWidget);
        if (scale == 1) await screenshot(tester, 'login-${width.toInt()}');
        await tap(tester, find.text('Create account'));
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        addTearDown(tester.view.resetViewInsets);
        await tester.pumpAndSettle();
        await tap(tester, find.byTooltip('Show password'));
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.text('Continue as guest'));
        await tester.pumpAndSettle();
        expect(find.text('Continue as guest').hitTestable(), findsOneWidget);
        expect(
          adapter.requests.every((r) => r.path.startsWith('/flupflap/')),
          true,
        );
      });
    }
  }

  testWidgets(
    'saved recipient prefills recharge; AUTO, quote and purchase remain server-authoritative',
    (tester) async {
      final (_, adapter) = await app(tester, 390);
      await tap(
        tester,
        find.widgetWithText(NavigationDestination, 'Recipients'),
      );
      await tap(tester, find.text(recipient['nickname']!));
      expect(
        tester.widget<TextField>(find.byType(TextField).first).controller!.text,
        '5551234567',
      );
      await tap(tester, find.text('Continue'));
      final detection = adapter.requests.singleWhere(
        (r) => r.path.endsWith('/operators/detect'),
      );
      expect(detection.queryParameters, {
        'country': 'US',
        'phone': recipient['phone'],
      });
      await tap(tester, find.text(terms['productName'] as String));
      await tap(tester, find.text('Continue'));
      final quote = adapter.requests.singleWhere(
        (r) => r.path.endsWith('/quotes'),
      );
      expect(quote.data, {
        'countryCode': 'US',
        'phone': recipient['phone'],
        'operatorId': 255,
        'productId': 'fixture-product',
      });
      expect(find.text('6.24 USD'), findsOneWidget);
      await screenshot(tester, 'review-390');
      await tap(tester, find.byType(CheckboxListTile));
      await tap(tester, find.text('Confirm MOCK test recharge'));
      final purchase = adapter.requests.singleWhere(
        (r) => r.path.endsWith('/transactions') && r.method == 'POST',
      );
      expect(purchase.data, {
        'quoteId': 'quote-fixture',
        'recipientId': 'recipient-fixture',
      });
      expect(purchase.headers['Idempotency-Key'], isNotEmpty);
      expect(find.text('Pending payment'), findsOneWidget);
      expect(find.text('Delivered'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  for (final status in [
    'DELIVERED',
    'PENDING',
    'PROCESSING',
    'FAILED',
    'REFUNDED',
  ]) {
    testWidgets('$status history opens an honest receipt without purchasing', (
      tester,
    ) async {
      final (_, adapter) = await app(tester, 360, status: status);
      await tap(tester, find.widgetWithText(NavigationDestination, 'History'));

      expect(
        find.text(
          status == 'REFUNDED'
              ? 'Refund confirmed'
              : '${status[0]}${status.substring(1).toLowerCase()}',
        ),
        findsOneWidget,
      );
      if (status != 'DELIVERED') {
        expect(find.text('Delivered'), findsNothing);
      }
      expect(
        adapter.requests.where(
          (r) => r.method == 'POST' && r.path.contains('mobile-topups'),
        ),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    });
  }

  for (final status in ['DELIVERED', 'FAILED', 'REFUNDED']) {
    testWidgets(
      '$status history does not replace Destination on Home or Recharge entry',
      (tester) async {
        final (_, adapter) = await app(tester, 390, status: status);
        await tap(tester, find.text('Send a recharge'));
        expect(find.text('Country'), findsOneWidget);
        await tap(
          tester,
          find.widgetWithText(NavigationDestination, 'History'),
        );
        expect(
          find.text(
            status == 'REFUNDED'
                ? 'Refund confirmed'
                : '${status[0]}${status.substring(1).toLowerCase()}',
          ),
          findsOneWidget,
        );
        await tap(
          tester,
          find.widgetWithText(NavigationDestination, 'Recharge'),
        );
        expect(find.text('Country'), findsOneWidget);
        expect(
          adapter.requests.where(
            (r) => r.method == 'POST' && r.path.contains('mobile-topups'),
          ),
          isEmpty,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'recipient creation uses catalog countries and existing isolated save endpoint',
    (tester) async {
      final (_, adapter) = await app(tester, 360);
      await tap(
        tester,
        find.widgetWithText(NavigationDestination, 'Recipients'),
      );
      await tap(tester, find.text('Add recipient'));
      await tester.enterText(
        find.widgetWithText(TextField, 'Recipient name'),
        'Family',
      );
      await tap(tester, find.byKey(const ValueKey('phone-country-picker')));
      await tester.enterText(
        find.byKey(const ValueKey('phone-country-search')),
        'HT',
      );
      await tester.pumpAndSettle();
      await tap(tester, find.text('Haiti').last);
      await tester.enterText(
        find.widgetWithText(TextField, 'Phone number'),
        '37000000',
      );
      await tap(tester, find.text('Save recipient'));
      expect(
        adapter.requests
            .singleWhere(
              (r) => r.method == 'POST' && r.path.endsWith('/recipients'),
            )
            .data,
        {'nickname': 'Family', 'phone': '+50937000000', 'countryCode': 'HT'},
      );
      expect(find.text('Family'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'guest account exposes no profile write and logout clears its session',
    (tester) async {
      final (session, adapter) = await app(tester, 360, guest: true);
      await tap(tester, find.widgetWithText(NavigationDestination, 'Account'));
      expect(find.text('Save profile'), findsNothing);
      expect(find.textContaining('separate from your TiCash'), findsOneWidget);
      await tap(tester, find.text('Sign out'));
      expect(session.authenticated, false);
      expect(adapter.requests.where((r) => r.method == 'PATCH'), isEmpty);
    },
  );

  testWidgets(
    'auth keyboard, visibility, forgot and reset preserve isolated endpoints',
    (tester) async {
      tester.view.physicalSize = const Size(390, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final adapter = CatalogAdapter();
      final session = FlupFlapSession(
        dio: Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
          ..httpClientAdapter = adapter,
        storage: MemoryStorage(),
      );
      await session.initialize();
      await tester.pumpWidget(FlupFlapApp(session: session));
      await tester.pumpAndSettle();
      await screenshot(tester, 'login-390');
      await tester.enterText(
        find.widgetWithText(TextField, 'Email'),
        'customer@example.test',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Password'),
        'test-password',
      );
      await tap(tester, find.byTooltip('Show password'));
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'Password'))
            .obscureText,
        false,
      );
      await tap(tester, find.text('Forgot password?'));
      expect(
        adapter.requests
            .singleWhere((r) => r.path.endsWith('/forgot-password'))
            .data,
        {'email': 'customer@example.test'},
      );
      await tester.showKeyboard(find.widgetWithText(TextField, 'Password'));
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(
        adapter.requests.where((r) => r.path.endsWith('/login')).length,
        1,
        reason: adapter.requests.map((r) => r.path).join(', '),
      );
      expect(session.authenticated, true);
      final context = tester.element(find.byType(HomeScreen));
      GoRouter.of(context).go('/reset-password?token=fixture-reset');
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Password'),
        'new-test-password',
      );
      await tap(tester, find.text('Update password'));
      expect(
        adapter.requests
            .singleWhere((r) => r.path.endsWith('/reset-password'))
            .data,
        {'token': 'fixture-reset', 'password': 'new-test-password'},
      );
      expect(session.authenticated, false);
      expect(find.text('Sign in to FlupFlap'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'permanent billing profile uses only the existing FlupFlap profile endpoint',
    (tester) async {
      final (session, adapter) = await app(tester, 390);
      await tap(tester, find.widgetWithText(NavigationDestination, 'Account'));
      await tester.enterText(
        find.widgetWithText(TextField, 'Country code'),
        'ht',
      );
      await tap(tester, find.text('Save profile'));
      final request = adapter.requests.singleWhere((r) => r.method == 'PATCH');
      expect(request.path, '/flupflap/auth/me');
      expect(request.data, {'countryCode': 'HT'});
      expect(session.user?['countryCode'], 'HT');
      expect(find.text('Profile updated'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'repeat obtains a fresh server quote and never purchases automatically',
    (tester) async {
      final (_, adapter) = await app(tester, 390, status: 'DELIVERED');
      await tap(tester, find.widgetWithText(NavigationDestination, 'History'));
      await tap(tester, find.text('Repeat with a new quote'));
      expect(
        adapter.requests
            .where((r) => r.path.endsWith('/transaction-fixture/repeat'))
            .length,
        1,
      );
      await tester.scrollUntilVisible(
        find.text('6.24 USD'),
        200,
        scrollable: find
            .byWidgetPredicate(
              (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
            )
            .last,
      );
      expect(find.text('6.24 USD'), findsOneWidget);
      expect(
        adapter.requests.where(
          (r) => r.method == 'POST' && r.path.endsWith('/transactions'),
        ),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'catalog errors stay visible and retry never bypasses availability',
    (tester) async {
      final (_, adapter) = await app(tester, 375);
      adapter.unavailable = true;
      await tap(tester, find.widgetWithText(NavigationDestination, 'Recharge'));
      expect(
        find.textContaining('Unable to complete this request'),
        findsOneWidget,
      );
      expect(find.text('Confirm sandbox recharge'), findsNothing);
      adapter.unavailable = false;
      await tap(tester, find.text('Retry'));
      expect(find.text('Country'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'Android return strips capability from route and only reads backend status',
    (tester) async {
      final adapter = CatalogAdapter();
      final session = FlupFlapSession(
        dio: Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
          ..httpClientAdapter = adapter,
        storage: MemoryStorage(),
      );
      await session.initialize();
      await tester.pumpWidget(FlupFlapApp(session: session));
      await tester.pumpAndSettle();
      final router = GoRouter.of(tester.element(find.byType(AuthScreen)));
      router.go('flupflap://checkout-return?checkoutResumeToken=${'a' * 43}');
      await tester.pumpAndSettle();
      expect(
        router.routeInformationProvider.value.uri.toString(),
        '/checkout-return',
      );
      expect(find.text('Pending payment'), findsOneWidget);
      expect(session.authenticated, false);
      router.go('flupflap://checkout-return?checkoutResumeToken=${'b' * 43}');
      await tester.pumpAndSettle();
      final calls = adapter.requests
          .where((r) => r.path.endsWith('/checkout-resume'))
          .toList();
      expect(calls.length, 2);
      expect(calls.last.data, {'resumeToken': 'b' * 43});
      expect(
        adapter.requests.where(
          (r) => r.method == 'POST' && !r.path.endsWith('/checkout-resume'),
        ),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
