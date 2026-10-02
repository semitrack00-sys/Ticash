import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:flupflap/recharge_screen.dart';
import 'package:flupflap/recharge_journey.dart';
import 'package:flupflap/parity_strings.dart';
import 'package:flupflap/native_actions.dart';
import 'package:flupflap/main.dart' show flupFlapTheme;
import 'package:ticash/localization/app_localizations.dart';
import 'checkout_parity_test.dart' show fixture;

Future<void> capture(WidgetTester t, String name) async {
  final dir = Platform.environment['FLUPFLAP_SCREENSHOT_DIR'];
  if (dir == null) return;
  final boundary = t.allRenderObjects
      .whereType<RenderRepaintBoundary>()
      .firstWhere((r) => r.size == t.view.physicalSize);
  await t.runAsync(() async {
    final image = await boundary.toImage();
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    await Directory(dir).create(recursive: true);
    await File('$dir/$name.png').writeAsBytes(data!.buffer.asUint8List());
    image.dispose();
  });
}

Future<void> press(WidgetTester t, Finder f) async {
  await t.ensureVisible(f);
  await t.pumpAndSettle();
  await t.tap(f);
  await t.pumpAndSettle();
}

Widget shell(Widget child, {AppLanguage language = AppLanguage.english}) =>
    AppLocalizationScope(
      language: language,
      child: MaterialApp(
        theme: flupFlapTheme(),
        locale: language.materialLocale,
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        supportedLocales: const [
          Locale('en'),
          Locale('fr'),
          Locale('es'),
          Locale('pt'),
        ],
        home: child,
      ),
    );
void main() {
  setUpAll(() async {
    final font = Platform.environment['FLUPFLAP_TEST_FONT'];
    if (font != null) {
      for (final pair in [
        ('Roboto', font),
        (
          'MaterialIcons',
          '${File(font).parent.path}/materialicons-regular.otf',
        ),
      ]) {
        await (FontLoader(pair.$1)..addFont(
              Future.value(
                ByteData.sublistView(File(pair.$2).readAsBytesSync()),
              ),
            ))
            .load();
      }
    }
  });
  testWidgets('local flags render and missing asset falls back to ISO', (
    t,
  ) async {
    await t.pumpWidget(
      shell(
        const Scaffold(
          body: Row(
            children: [
              CountryFlag('US'),
              CountryFlag('HT'),
              CountryFlag('FR'),
              CountryFlag('BR'),
              CountryFlag('JP'),
              CountryFlag('ZA'),
              CountryFlag('ZZ'),
            ],
          ),
        ),
      ),
    );
    await t.pumpAndSettle();
    expect(find.text('ZZ'), findsOneWidget);
    expect(t.takeException(), isNull);
    for (final code in ['us', 'ht', 'fr', 'br', 'jp', 'za']) {
      expect(
        (await rootBundle.load('assets/flags/$code.svg')).lengthInBytes,
        greaterThan(0),
      );
    }
  });
  for (final width in [360.0, 375.0, 390.0, 412.0, 430.0, 768.0]) {
    for (final scale in [1.0, 1.5]) {
      testWidgets(
        'all checkout steps width=$width scale=$scale keyboard/back',
        (t) async {
          t.view.physicalSize = Size(width, 900);
          t.view.devicePixelRatio = 1;
          t.platformDispatcher.textScaleFactorTestValue = scale;
          addTearDown(t.view.resetPhysicalSize);
          addTearDown(t.view.resetDevicePixelRatio);
          addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
          addTearDown(t.view.resetViewInsets);
          final (a, _, j) = fixture();
          await t.runAsync(j.initialize);
          j.destination(code: 'HT', number: '+50937000000');
          final router = GoRouter(
            routes: [
              GoRoute(
                path: '/',
                builder: (_, __) => RechargeJourneyScreen(journey: j),
              ),
            ],
          );
          addTearDown(router.dispose);
          await t.pumpWidget(
            AppLocalizationScope(
              language: AppLanguage.english,
              child: MaterialApp.router(
                routerConfig: router,
                theme: flupFlapTheme(),
              ),
            ),
          );
          await t.pumpAndSettle();
          if (scale == 1) await capture(t, 'destination-${width.toInt()}');
          await press(t, find.text('Continue'));
          expect(j.step, RechargeStep.product);
          await press(t, find.text('Catalog range'));
          await t.enterText(find.byKey(const ValueKey('range-amount')), '6.50');
          t.view.viewInsets = const FakeViewPadding(bottom: 300);
          await t.pumpAndSettle();
          await press(t, find.text('Continue'));
          expect(j.step, RechargeStep.review);
          expect(t.takeException(), isNull);
          t.view.viewInsets = const FakeViewPadding();
          await t.pumpAndSettle();
          await press(t, find.text('Billing country'));
          await t.enterText(
            find.widgetWithText(TextField, 'Search countries'),
            'United States',
          );
          await t.pumpAndSettle();
          await press(t, find.widgetWithText(ListTile, 'United States'));
          expect(j.billingCountry, 'US');
          expect(j.country, 'HT');
          if (scale == 1) await capture(t, 'checkout-review-${width.toInt()}');
          await t.binding.handlePopRoute();
          await t.pumpAndSettle();
          expect(j.step, RechargeStep.product);
          expect(j.product?.id, 'range');
          await press(t, find.text('Continue'));
          await press(t, find.byType(CheckboxListTile));
          final calls = <MethodCall>[];
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(NativeActions.channel, (call) async {
                calls.add(call);
                return null;
              });
          addTearDown(
            () => TestDefaultBinaryMessengerBinding
                .instance
                .defaultBinaryMessenger
                .setMockMethodCallHandler(NativeActions.channel, null),
          );
          await press(t, find.text('Continue to test payment'));
          expect(j.step, RechargeStep.payment);
          expect(j.locked, true);
          expect(calls.single.method, 'checkout');
          await t.binding.handlePopRoute();
          await t.pumpAndSettle();
          expect(j.locked, true);
          await t.runAsync(j.refresh);
          await t.pumpAndSettle();
          expect(find.text('Pending payment'), findsOneWidget);
          expect(find.text('Delivered'), findsNothing);
          if (scale == 1) await capture(t, 'processing-${width.toInt()}');
          a.transactionStatus = 'DELIVERED';
          a.paymentStatus = 'CAPTURED';
          await t.runAsync(j.refresh);
          await t.pumpAndSettle();
          expect(find.text('Delivered'), findsOneWidget);
          expect(j.locked, false);
          expect(t.takeException(), isNull);
          if (scale == 1) await capture(t, 'delivered-${width.toInt()}');
          await press(t, find.text(flupFlapStrings['en']!['another']!));
          expect(j.step, RechargeStep.destination);
          expect(j.phone, isEmpty);
          expect(
            t.widget<TextField>(find.byType(TextField).first).controller!.text,
            isEmpty,
          );
          await t.pumpWidget(const SizedBox());
        },
      );
    }
  }
  testWidgets('country search and promo input; localized labels switch', (
    t,
  ) async {
    final (_, _, j) = fixture();
    await t.runAsync(j.initialize);
    j.destination(code: 'HT', number: '+50937000000');
    await t.runAsync(j.continueDestination);
    await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const ValueKey('promotion-code')), 'welcome');
    await press(t, find.text('Apply'));
    expect(j.notice, 'promotionApplied');
    for (final language in AppLanguage.values) {
      await t.pumpWidget(
        shell(RechargeJourneyScreen(journey: j), language: language),
      );
      await t.pumpAndSettle();
      expect(
        find.text(flupFlapStrings[language.code]!['operatorProduct']!),
        findsWidgets,
      );
      expect(t.takeException(), isNull);
    }
    await t.pumpWidget(const SizedBox());
  });
  for (final width in [360.0, 375.0, 390.0, 412.0, 430.0]) {
    testWidgets('abandoned reservation opens Destination directly at $width', (
      t,
    ) async {
      t.view.physicalSize = Size(width, 900);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.resetPhysicalSize);
      addTearDown(t.view.resetDevicePixelRatio);
      final (a, _, j) = fixture();
      a.pendingHistory = true;
      a.transactionStatus = a.paymentStatus = 'PENDING';
      await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
      await t.pumpAndSettle();
      expect(j.locked, false);
      expect(j.step, RechargeStep.destination);
      expect(find.text('Country'), findsOneWidget);
      expect(find.text('Pending payment'), findsNothing);
      expect(find.text('Check status'), findsNothing);
      expect(j.history.single.terminal, true);
      expect(t.takeException(), isNull);
      await t.pumpWidget(const SizedBox());
    });
    testWidgets('pending recovery cancellation and Back at $width', (t) async {
      t.view.physicalSize = Size(width, 900);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.resetPhysicalSize);
      addTearDown(t.view.resetDevicePixelRatio);
      final (a, _, j) = fixture();
      a.pendingHistory = true;
      await t.runAsync(j.initialize);
      await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
      await t.pumpAndSettle();
      expect(find.text('Pending payment'), findsOneWidget);
      expect(find.text('Open secure Stripe checkout'), findsNothing);
      expect(j.canBack, false);
      await capture(t, 'pending-recovery-${width.toInt()}');
      a.cancelCode = 'TOPUP_CANCELLATION_UNRESOLVED';
      await press(t, find.text(flupFlapStrings['en']!['cancelPending']!));
      expect(j.locked, true);
      expect(
        find.text(flupFlapStrings['en']!['cancellationUnresolved']!),
        findsOneWidget,
      );
      a.cancelCode = null;
      await press(t, find.text(flupFlapStrings['en']!['cancelPending']!));
      expect(j.locked, false);
      expect(j.step, RechargeStep.destination);
      expect(find.text('Country'), findsOneWidget);
      expect(t.takeException(), isNull);
      await capture(t, 'pending-cancelled-${width.toInt()}');
      await t.pumpWidget(const SizedBox());
    });
  }
  testWidgets('pending recovery actions use all five languages', (t) async {
    final (a, _, j) = fixture(autoDispose: false);
    a.pendingHistory = true;
    await t.runAsync(j.initialize);
    for (final language in AppLanguage.values) {
      await t.pumpWidget(
        shell(RechargeJourneyScreen(journey: j), language: language),
      );
      await t.pumpAndSettle();
      expect(
        find.text(flupFlapStrings[language.code]!['pendingPayment']!),
        findsOneWidget,
      );
      expect(
        find.text(flupFlapStrings[language.code]!['cancelPending']!),
        findsOneWidget,
      );
      expect(t.takeException(), isNull);
    }
    await t.pumpWidget(const SizedBox());
    j.dispose();
  });
  test('native checkout rejects wrong host before platform call', () async {
    await expectLater(
      NativeActions.checkout(Uri.parse('https://evil.example/pay')),
      throwsFormatException,
    );
  });
}
