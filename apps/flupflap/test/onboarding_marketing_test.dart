import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/account_parity.dart';
import 'package:flupflap/checkout_contract.dart';
import 'package:flupflap/main.dart';
import 'package:flupflap/native_actions.dart';
import 'package:flupflap/phone_country_field.dart';
import 'package:flupflap/recharge_journey.dart';
import 'package:flupflap/recharge_screen.dart';
import 'package:flupflap/session.dart';
import 'package:ticash/localization/app_localizations.dart';
import 'flupflap_test.dart' as auth;
import 'checkout_parity_test.dart' as checkout;
import 'parity_widget_test.dart' show shell, press, capture;

const qr =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1cAAAAASUVORK5CYII=';
final code = 'b' * 32;
final link = 'https://www.flupflap.com/join?r=$code';

void phoneViewport(WidgetTester t) {
  t.view.physicalSize = const Size(360, 900);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  addTearDown(t.view.resetDevicePixelRatio);
}

class ShareAdapter extends auth.FixtureAdapter {
  bool invalidLink = false, fail = false;
  @override
  Future<ResponseBody> fetch(
    RequestOptions o,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    if (!o.path.startsWith('/flupflap/marketing/share')) {
      return super.fetch(o, stream, cancel);
    }
    requests.add(o);
    return ResponseBody.fromString(
      jsonEncode(
        o.path.endsWith('/qr')
            ? {'dataUrl': 'data:image/png;base64,$qr'}
            : {
                'code': code,
                'url': invalidLink ? 'https://untrusted.example/join' : link,
              },
      ),
      fail ? 503 : 200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}

class PromoAdapter extends checkout.ParityAdapter {
  bool rejected = false;
  @override
  Future<ResponseBody> fetch(
    RequestOptions o,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    if (!o.path.endsWith('/visits')) return super.fetch(o, stream, cancel);
    requests.add(o);
    return ResponseBody.fromString(
      jsonEncode(
        rejected
            ? {'code': 'PROMOTION_UNAVAILABLE'}
            : {
                'capability': 'a' * 43,
                'promotion': {
                  'name': 'Server welcome offer',
                  'code': 'WELCOME',
                },
              },
      ),
      rejected ? 409 : 200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }
}

void noPurchases(List<RequestOptions> requests) {
  expect(
    requests.where(
      (r) =>
          r.method != 'GET' &&
          RegExp(
            r'payment|transactions|purchase|refund|reward|sms',
          ).hasMatch(r.path),
    ),
    isEmpty,
  );
  expect(requests.every((r) => r.path.startsWith('/flupflap/')), isTrue);
}

void main() {
  setUpAll(() async {
    final font = Platform.environment['FLUPFLAP_TEST_FONT'];
    if (font != null) {
      for (final item in [
        ('Roboto', font),
        (
          'MaterialIcons',
          '${File(font).parent.path}/materialicons-regular.otf',
        ),
      ]) {
        await (FontLoader(item.$1)..addFont(
              Future.value(
                ByteData.sublistView(File(item.$2).readAsBytesSync()),
              ),
            ))
            .load();
      }
    }
  });

  for (final size in [
    const Size(320, 640),
    const Size(360, 800),
    const Size(360, 900),
    const Size(390, 844),
    const Size(412, 915),
    const Size(430, 932),
  ]) {
    for (final scale in [1.0, 1.5]) {
      testWidgets(
        'compact sign-in fits $size at scale $scale and keyboard stays usable',
        (t) async {
          t.view.physicalSize = size;
          t.view.devicePixelRatio = 1;
          t.platformDispatcher.textScaleFactorTestValue = scale;
          addTearDown(t.view.resetPhysicalSize);
          addTearDown(t.view.resetDevicePixelRatio);
          addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
          final (s, adapter, _) = auth.fixture();
          await s.initialize();
          await t.pumpWidget(FlupFlapApp(session: s));
          await t.pumpAndSettle();
          await t.runAsync(
            () => precacheImage(
              const AssetImage('assets/flupflap-logo.png'),
              t.element(find.byType(Brand)),
            ),
          );
          await t.pump();
          expect(find.byType(DropdownButton<AppLanguage>), findsOneWidget);
          expect(find.byType(Brand), findsOneWidget);
          expect(find.text('Welcome'), findsOneWidget);
          expect(find.text('Sign in to continue.'), findsOneWidget);
          expect(find.text('Sign in to FlupFlap'), findsNothing);
          expect(find.text('Welcome back'), findsNothing);
          final logo = find.descendant(
            of: find.byType(Brand),
            matching: find.byType(Image),
          );
          expect(
            (t.widget<Image>(logo).image as AssetImage).assetName,
            'assets/flupflap-logo.png',
          );
          expect(t.getSize(logo).width, inInclusiveRange(220, 280));
          expect(
            t.getSize(logo).height,
            closeTo(t.getSize(logo).width / 3, .01),
          );
          expect(find.text('Create account'), findsOneWidget);
          expect(find.text('Forgot password?'), findsOneWidget);
          if (scale == 1) {
            expect(
              t.getSize(find.byKey(const ValueKey('auth-card'))).height,
              // Larger approved heading, 24px card padding and 54px guest CTA.
              lessThan(560),
            );
            expect(find.text('Sign in').hitTestable(), findsOneWidget);
            await t.ensureVisible(find.text('Continue as guest'));
            await t.pumpAndSettle();
            expect(
              find.text('Continue as guest').hitTestable(),
              findsOneWidget,
            );
            // Capture the initial balanced composition, before keyboard/scroll QA.
            await t.ensureVisible(find.byType(Brand));
            await t.pumpAndSettle();
            await capture(t, 'signin-${size.width.toInt()}');
          }
          t.view.viewInsets = const FakeViewPadding(bottom: 280);
          addTearDown(t.view.resetViewInsets);
          await t.pumpAndSettle();
          await press(t, find.byTooltip('Show password'));
          expect(
            t
                .widget<TextField>(find.widgetWithText(TextField, 'Password'))
                .obscureText,
            isFalse,
          );
          await t.ensureVisible(find.text('Forgot password?'));
          await t.pumpAndSettle();
          expect(find.text('Forgot password?').hitTestable(), findsOneWidget);
          await t.ensureVisible(find.text('Create account'));
          await t.pumpAndSettle();
          expect(find.text('Create account').hitTestable(), findsOneWidget);
          expect(t.takeException(), isNull);
          noPurchases(adapter.requests);
          await t.pumpWidget(const SizedBox());
        },
      );
    }
  }

  for (final sample in [
    ('HT', '37000000', '+50937000000'),
    ('US', '2025550123', '+12025550123'),
    ('US', '8095551234', '+18095551234'),
    ('HT', '+33 6 12 34 56 78', '+33612345678'),
    ('BR', '11987654321', '+5511987654321'),
  ]) {
    testWidgets(
      'registration normalizes ${sample.$1} ${sample.$2} before submission',
      (t) async {
        t.platformDispatcher.localesTestValue = [Locale('en', sample.$1)];
        addTearDown(t.platformDispatcher.clearLocalesTestValue);
        final (s, adapter, _) = auth.fixture();
        await t.pumpWidget(
          shell(AuthScreen(session: s, initialRegistration: true)),
        );
        await t.pumpAndSettle();
        expect(
          t
              .widget<PhoneCountryField>(find.byType(PhoneCountryField))
              .showCountryName,
          isTrue,
        );
        expect(find.text(PhoneCountry.find(sample.$1)!.name), findsOneWidget);
        await press(t, find.widgetWithText(FilledButton, 'Create account'));
        expect(adapter.requests, isEmpty);
        expect(
          find.text('Enter a valid phone number for the selected country.'),
          findsOneWidget,
        );
        await t.enterText(
          find.byKey(const ValueKey('registration-phone')),
          sample.$2,
        );
        for (final entry in [
          ('First name', 'Test'),
          ('Last name', 'Customer'),
          ('Email', 'person@example.test'),
          ('Password', 'test-password'),
        ]) {
          await t.enterText(find.widgetWithText(TextField, entry.$1), entry.$2);
        }
        await press(t, find.widgetWithText(FilledButton, 'Create account'));
        expect(
          adapter.requests
              .singleWhere((r) => r.path.endsWith('/register'))
              .data['phone'],
          sample.$3,
        );
        expect(
          find.text('Enter a valid phone number for the selected country.'),
          findsNothing,
        );
        noPurchases(adapter.requests);
        await t.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets(
    'registration picker searches countries and invalid national lengths block requests',
    (t) async {
      phoneViewport(t);
      final (s, adapter, _) = auth.fixture();
      await t.pumpWidget(
        // Capture the navigator overlay as well as the underlying form.
        RepaintBoundary(
          child: shell(AuthScreen(session: s, initialRegistration: true)),
        ),
      );
      await press(t, find.byKey(const ValueKey('phone-country-picker')));
      await t.enterText(
        find.byKey(const ValueKey('phone-country-search')),
        'Haiti',
      );
      await t.pumpAndSettle();
      await capture(t, 'registration-country-picker');
      await press(t, find.byKey(const ValueKey('phone-country-HT')));
      expect(find.text('Haiti'), findsOneWidget);
      expect(find.text('+509'), findsOneWidget);
      await t.enterText(
        find.byKey(const ValueKey('registration-phone')),
        '37000000',
      );
      await t.pumpAndSettle();
      await capture(t, 'registration-phone');
      for (final value in ['3700000', '+509370000000']) {
        await t.enterText(
          find.byKey(const ValueKey('registration-phone')),
          value,
        );
        await press(t, find.widgetWithText(FilledButton, 'Create account'));
        expect(adapter.requests, isEmpty);
        expect(
          find.text('Enter a valid phone number for the selected country.'),
          findsOneWidget,
        );
      }
      await capture(t, 'registration-error');
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'visible promo panel reports backend acceptance/rejection and only fresh quotes supply benefits',
    (t) async {
      phoneViewport(t);
      final a = PromoAdapter();
      final c = FlupFlapClient(
        Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
          ..httpClientAdapter = a,
      );
      final j = RechargeJourney(
        c,
        guest: () => false,
        storedBillingCountry: () => 'US',
      );
      await t.runAsync(() => checkout.reviewed(j));
      await t.runAsync(j.back);
      await t.pumpWidget(shell(RechargeJourneyScreen(journey: j)));
      await t.pumpAndSettle();
      expect(find.text('Have a promo code?'), findsOneWidget);
      await t.enterText(
        find.byKey(const ValueKey('promotion-code')),
        'welcome',
      );
      await press(t, find.byKey(const ValueKey('apply-promo')));
      expect(find.text('Code saved: Server welcome offer'), findsOneWidget);
      expect(j.quote, isNull);
      expect(j.canPay, isFalse);
      expect(a.quoteCount, 1);
      await capture(t, 'promo-applied');
      await press(t, find.widgetWithText(FilledButton, 'Continue'));
      expect(a.quoteCount, 2);
      expect(j.quote!.feeUsd, .74);
      expect(find.text('Server promotion'), findsOneWidget);
      await t.runAsync(j.back);
      await t.pumpAndSettle();
      a.rejected = true;
      await t.enterText(
        find.byKey(const ValueKey('promotion-code')),
        'expired',
      );
      await press(t, find.byKey(const ValueKey('apply-promo')));
      expect(
        find.text(
          'This code is invalid, expired, or unavailable for your account.',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('promo-success')), findsNothing);
      expect(j.quote, isNull);
      expect(j.canPay, isFalse);
      noPurchases(a.requests);
      await t.pumpWidget(const SizedBox());
      j.dispose();
    },
  );

  testWidgets(
    'registered share card uses only issued code/link/QR and handles copy and native sharing',
    (t) async {
      phoneViewport(t);
      final a = ShareAdapter();
      final s = FlupFlapSession(
        dio: Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
          ..httpClientAdapter = a,
        storage: auth.MemoryStorage(),
      );
      await t.runAsync(() => s.login('person@example.test', 'test-password'));
      final calls = <MethodCall>[], copied = <String>[];
      t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied.add((call.arguments as Map)['text'] as String);
          }
          return null;
        },
      );
      t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        NativeActions.channel,
        (call) async {
          calls.add(call);
          if ((call.arguments as Map)['target'] == 'whatsapp') {
            throw PlatformException(code: 'UNAVAILABLE');
          }
          return null;
        },
      );
      addTearDown(() {
        t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          NativeActions.channel,
          null,
        );
        t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        );
      });
      await t.pumpWidget(
        shell(
          Scaffold(
            body: SingleChildScrollView(
              child: AccountParity(
                session: s,
                client: FlupFlapClient(s.dio),
                language: AppLanguage.english,
                onLanguage: (_) {},
              ),
            ),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Share FlupFlap'), findsOneWidget);
      expect(find.byType(ExpansionTile), findsNothing);
      expect(find.text(code), findsOneWidget);
      expect(
        (t.widget<Image>(find.byKey(const ValueKey('referral-qr'))).image
                as MemoryImage)
            .bytes,
        base64Decode(qr),
      );
      await press(t, find.text('Copy referral code'));
      await press(t, find.text('Copy referral link'));
      expect(copied, [code, link]);
      await press(t, find.text('Share'));
      await press(t, find.text('WhatsApp'));
      expect(calls.map((c) => (c.arguments as Map)['target']), [
        'share',
        'whatsapp',
        'share',
      ]);
      expect(
        calls.every(
          (c) =>
              c.method == 'share' &&
              (c.arguments as Map)['text'] ==
                  'Join FlupFlap with my referral code $code: $link',
        ),
        isTrue,
      );
      expect(
        a.requests
            .where((r) => r.path.contains('/marketing/share'))
            .map((r) => r.method),
        ['GET', 'GET'],
      );
      await capture(t, 'share-card');
      noPurchases(a.requests);
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'guest share card never requests referral endpoints and opens registration',
    (t) async {
      final (s, a, _) = auth.fixture();
      await s.initialize();
      await t.runAsync(s.enterGuest);
      await t.pumpWidget(FlupFlapApp(session: s));
      await t.pumpAndSettle();
      await press(t, find.widgetWithText(NavigationDestination, 'Account'));
      expect(
        find.text('Create an account to get your referral code'),
        findsOneWidget,
      );
      final createAccount = find.widgetWithText(FilledButton, 'Create account');
      await t.ensureVisible(createAccount);
      await t.runAsync(() async {
        await t.tap(createAccount);
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      await t.pumpAndSettle();
      expect(find.text('Create FlupFlap account'), findsOneWidget);
      expect(find.byType(PhoneCountryField), findsOneWidget);
      expect(
        a.requests.where((r) => r.path.contains('/marketing/share')),
        isEmpty,
      );
      noPurchases(a.requests);
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'untrusted referral URL is never displayed or shared and retry remains available',
    (t) async {
      final a = ShareAdapter()..invalidLink = true;
      final s = FlupFlapSession(
        dio: Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
          ..httpClientAdapter = a,
        storage: auth.MemoryStorage(),
      );
      await t.runAsync(() => s.login('person@example.test', 'test-password'));
      await t.pumpWidget(
        shell(
          Scaffold(
            body: SingleChildScrollView(
              child: AccountParity(
                session: s,
                client: FlupFlapClient(s.dio),
                language: AppLanguage.english,
                onLanguage: (_) {},
              ),
            ),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.textContaining('untrusted.example'), findsNothing);
      expect(find.text('Copy referral code'), findsNothing);
      expect(find.text('Retry'), findsOneWidget);
      a.invalidLink = false;
      await press(t, find.text('Retry'));
      expect(find.text(code), findsOneWidget);
      noPurchases(a.requests);
      await t.pumpWidget(const SizedBox());
    },
  );
}
