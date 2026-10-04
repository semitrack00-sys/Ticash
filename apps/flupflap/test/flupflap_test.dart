import 'package:ticash/services/mobile_top_up_service.dart';
import 'dart:async';
import 'dart:io';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/main.dart';
import 'package:flupflap/session.dart';

class MemoryStorage implements SessionStorage {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String input) async {
    value = input;
  }

  @override
  Future<void> clear() async {
    value = null;
  }
}

class FixtureAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  bool denied = false;
  bool denyCountries = false;
  Completer<void>? holdCountries;
  final countriesStarted = Completer<void>();
  Completer<void>? holdRefresh;
  final refreshStarted = Completer<void>();
  Map<String, dynamic> user = {
    'id': 'flup-customer',
    'domain': 'FLUPFLAP',
    'email': 'flup@example.test',
    'guest': false,
  };
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    requests.add(options);
    if (options.path.endsWith('/countries') && holdCountries != null) {
      countriesStarted.complete();
      await holdCountries!.future;
    }
    if (options.path.endsWith('/refresh') && holdRefresh != null) {
      refreshStarted.complete();
      await holdRefresh!.future;
    }
    dynamic data = <String, dynamic>{};
    int status = 200;
    if (denied || (denyCountries && options.path.endsWith('/countries'))) {
      status = 401;
      data = {'error': 'Invalid credentials'};
    } else if ([
      '/flupflap/auth/login',
      '/flupflap/auth/register',
      '/flupflap/auth/guest',
      '/flupflap/auth/refresh',
    ].contains(options.path)) {
      user = {...user, 'guest': options.path.endsWith('/guest')};
      data = {
        'accessToken': 'fixture-access',
        'refreshToken': 'fixture-refresh',
        'user': user,
      };
    } else if (options.path.endsWith('/countries')) {
      data = {'countries': <dynamic>[]};
    } else if (options.path.endsWith('/transactions')) {
      data = {'transactions': <dynamic>[]};
    } else if (options.path.endsWith('/recipients')) {
      data = {'recipients': <dynamic>[]};
    } else if (options.path.endsWith('/status')) {
      data = {
        'enabled': false,
        'environment': 'SANDBOX',
        'testMode': true,
        'productionEnabled': false,
        'approvedForLiveUse': false,
        'liveRechargeEnabled': false,
      };
    } else if (options.path.endsWith('/me')) {
      data = {
        'user': {...user, ...options.data as Map},
      };
    }
    return ResponseBody.fromString(
      jsonEncode(data),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

(FlupFlapSession, FixtureAdapter, MemoryStorage) fixture() {
  final adapter = FixtureAdapter(), storage = MemoryStorage();
  final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
    ..httpClientAdapter = adapter;
  return (FlupFlapSession(dio: dio, storage: storage), adapter, storage);
}

void main() {
  test('old unauthorized response is not retried under a newer signed-in account', () async {
    final (session, adapter, _) = fixture();
    await session.login('flup@example.test', 'test-password');
    adapter.holdCountries = Completer<void>();
    final pending = session.dio.get<dynamic>('/flupflap/mobile-topups/countries');
    final rejected = expectLater(pending, throwsA(isA<DioException>()));
    await adapter.countriesStarted.future;
    await session.logout();
    adapter.user = {...adapter.user, 'id': 'new-account'};
    await session.login('new@example.test', 'test-password');
    adapter.denyCountries = true;
    adapter.holdCountries!.complete();
    await rejected;
    expect(session.user?['id'], 'new-account');
    expect(adapter.requests.where((r) => r.path.endsWith('/refresh')), isEmpty);
    expect(adapter.requests.where((r) => r.path.endsWith('/countries')).length, 1);
  });
  for (final refreshFails in [false, true]) {
    test('late refresh (failure: $refreshFails) cannot erase or replay a newer login', () async {
      final (session, adapter, storage) = fixture();
      await session.login('flup@example.test', 'test-password');
      adapter.denyCountries = true;
      adapter.holdRefresh = Completer<void>();
      final pending = session.dio.get<dynamic>('/flupflap/mobile-topups/countries');
      final rejected = expectLater(pending, throwsA(isA<DioException>()));
      await adapter.refreshStarted.future;
      adapter.user = {...adapter.user, 'id': 'new-account'};
      await session.login('new@example.test', 'test-password');
      adapter.denied = refreshFails;
      adapter.holdRefresh!.complete();
      await rejected;
      expect(session.user?['id'], 'new-account');
      expect(session.authenticated, isTrue);
      expect(storage.value, 'fixture-refresh');
      expect(adapter.requests.where((r) => r.path.endsWith('/countries')).length, 1);
    });
  }
  test('startup refresh cannot clear a newer signed-in account', () async {
    final (session, adapter, storage) = fixture();
    storage.value = 'old-refresh';
    adapter.holdRefresh = Completer<void>();
    final initialize = session.initialize();
    await adapter.refreshStarted.future;
    adapter.user = {...adapter.user, 'id': 'new-account'};
    await session.login('new@example.test', 'test-password');
    adapter.holdRefresh!.complete();
    await initialize;
    expect(session.user?['id'], 'new-account');
    expect(session.authenticated, isTrue);
    expect(storage.value, 'fixture-refresh');
  });
  test('session rejects changed API destinations before sending credentials', () async {
    final (session, adapter, _) = fixture();
    await session.login('flup@example.test', 'test-password');
    for (final base in [
      'https://attacker.example/api', 'http://api.example.test/api',
      'https://api.example.test:444/api', 'https://api.example.test/other',
    ]) {
      session.dio.options.baseUrl = base;
      await expectLater(session.dio.get<dynamic>('/flupflap/auth/me'),
        throwsA(isA<DioException>()));
      await expectLater(session.login('flup@example.test', 'test-password'),
        throwsA(isA<DioException>()));
    }
    expect(adapter.requests.length, 1);
  });
  test('session disables redirects even when a caller enables them', () async {
    final (session, adapter, _) = fixture();
    await session.login('flup@example.test', 'test-password');
    await session.dio.get<dynamic>('/flupflap/mobile-topups/countries',
      options: Options(followRedirects: true, headers: {'authorization': 'Bearer wrong-token'}));
    expect(adapter.requests.every((r) => !r.followRedirects), isTrue);
    expect(adapter.requests.last.headers.entries.where((e) => e.key.toLowerCase() == 'authorization')
      .map((e) => e.value), ['Bearer fixture-access']);
  });
  testWidgets('registration sends locale-based national phone in E.164', (
    tester,
  ) async {
    tester.platformDispatcher.localesTestValue = [const Locale('fr', 'HT')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    final (s, adapter, _) = fixture();
    await s.initialize();
    await tester.pumpWidget(FlupFlapApp(session: s));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Create account'));
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();
    for (final field in [
      ('First name', 'Test'),
      ('Last name', 'Customer'),
      ('Phone number', '37000000'),
      ('Email', 'customer@example.test'),
      ('Password', 'test-password'),
    ]) {
      await tester.enterText(
        find.widgetWithText(TextField, field.$1),
        field.$2,
      );
    }
    await tester.ensureVisible(find.text('Create account'));
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();
    expect(
      adapter.requests
          .singleWhere((r) => r.path.endsWith('/auth/register'))
          .data['phone'],
      '+50937000000',
    );
    expect(s.authenticated, isTrue);
    await tester.pumpWidget(const SizedBox());
  });
  test(
    'shared recharge service uses only the FlupFlap API namespace',
    () async {
      final (s, a, _) = fixture();
      await s.login('flup@example.test', 'test-password');
      final service = MobileTopUpService(
        dio: s.dio,
        basePath: '/flupflap/mobile-topups',
      );
      await service.countries();
      await service.availability();
      await service.history();
      await service.recipients();
      expect(a.requests.skip(1).map((r) => r.path).toList(), [
        '/flupflap/mobile-topups/countries',
        '/flupflap/mobile-topups/status',
        '/flupflap/mobile-topups/transactions',
        '/flupflap/mobile-topups/recipients',
      ]);
      expect(
        a.requests
            .skip(1)
            .every(
              (r) => r.headers['Authorization'] == 'Bearer fixture-access',
            ),
        true,
      );
    },
  );

  test('logout wins over an already in-flight refresh', () async {
    final (s, a, storage) = fixture();
    await s.login('flup@example.test', 'test-password');
    a.holdRefresh = Completer<void>();
    final pending = s.refresh();
    final failure = expectLater(pending, throwsA(isA<StateError>()));
    await a.refreshStarted.future;
    await s.logout();
    a.holdRefresh!.complete();
    await failure;
    expect(s.authenticated, false);
    expect(storage.value, null);
  });
  test('Android identity and release signing stay separate from TiCash', () {
    final gradle = File('android/app/build.gradle').readAsStringSync();
    final manifest = File(
      'android/app/src/main/AndroidManifest.xml',
    ).readAsStringSync();
    expect(gradle, contains('applicationId "com.ticash.flupflap"'));
    expect(gradle, contains('Release signing is not configured'));
    expect(manifest, contains('android:label="FlupFlap"'));
    expect(manifest, contains('android:scheme="flupflap"'));
    expect(manifest, contains('android:allowBackup="false"'));
    expect(
      File('../mobile/android/app/build.gradle').readAsStringSync(),
      contains('applicationId "com.ticash.app"'),
    );
  });

  test(
    'signup uses separate identity and stores only FlupFlap refresh token',
    () async {
      final (s, a, storage) = fixture();
      await s.register(
        firstName: 'Flup',
        lastName: 'Customer',
        phone: '+15551234567',
        email: 'flup@example.test',
        password: 'test-password',
      );
      expect(a.requests.single.path, '/flupflap/auth/register');
      expect(a.requests.single.data, {
        'firstName': 'Flup',
        'lastName': 'Customer',
        'phone': '+15551234567',
        'email': 'flup@example.test',
        'password': 'test-password',
      });
      expect(s.authenticated, true);
      expect(storage.value, 'fixture-refresh');
      expect(SecureSessionStorage.key, startsWith('flupflap.'));
    },
  );
  test(
    'client blocks TiCash, absolute and traversal endpoints before transport',
    () async {
      final (s, a, _) = fixture();
      await s.login('flup@example.test', 'test-password');
      for (final path in [
        '/users/me',
        '/funding/wallet',
        '/admin/session',
        'https://bad.example/',
        '/flupflap/../users/me',
        '/flupflap/%2e%2e/users/me',
      ]) {
        await expectLater(
          s.dio.get<dynamic>(path),
          throwsA(isA<DioException>()),
        );
      }
      expect(a.requests.length, 1);
    },
  );
  test('guest, logout and refresh use only FlupFlap namespace', () async {
    final (s, a, storage) = fixture();
    await s.enterGuest();
    expect(s.guest, true);
    await s.refresh();
    await s.logout();
    expect(s.authenticated, false);
    expect(storage.value, null);
    expect(a.requests.every((r) => r.path.startsWith('/flupflap/auth/')), true);
  });
  test(
    'failed login never authenticates and logout clears credentials on network failure',
    () async {
      final (s, a, storage) = fixture();
      a.denied = true;
      await expectLater(
        s.login('bad@example.test', 'bad-password'),
        throwsA(isA<DioException>()),
      );
      expect(s.authenticated, false);
      a.denied = false;
      await s.login('flup@example.test', 'test-password');
      a.denied = true;
      await expectLater(s.logout(), throwsA(isA<DioException>()));
      expect(storage.value, null);
      expect(s.authenticated, false);
    },
  );
  testWidgets(
    'lightweight signup and guest entry are accessible without remittance fields',
    (tester) async {
      final (s, _, _) = fixture();
      await s.initialize();
      await tester.pumpWidget(FlupFlapApp(session: s));
      await tester.pumpAndSettle();
      expect(find.text('Welcome'), findsOneWidget);
      expect(find.text('Continue as guest'), findsOneWidget);
      expect(find.textContaining('KYC'), findsNothing);
      await tester.ensureVisible(find.text('Create account'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Create account'));
      await tester.pumpAndSettle();
      expect(find.text('Create FlupFlap account'), findsOneWidget);
      expect(find.text('First name'), findsOneWidget);
      expect(find.text('Last name'), findsOneWidget);
      expect(find.text('Phone number'), findsOneWidget);
      expect(find.byType(TextField), findsNWidgets(5));
      final guestButton = find.text('Continue as guest');
      await tester.ensureVisible(guestButton);
      await tester.tap(guestButton);
      await tester.pumpAndSettle();
      expect(find.text('Start recharge'), findsOneWidget);
    },
  );
  testWidgets(
    'separate navigation provides recharge, history, recipients, account and logout',
    (tester) async {
      final (s, a, _) = fixture();
      await s.initialize();
      await tester.runAsync(
        () => s.login('flup@example.test', 'test-password'),
      );
      await tester.pumpWidget(FlupFlapApp(session: s));
      await tester.pumpAndSettle();
      for (final label in ['Recharge', 'History', 'Recipients', 'Account']) {
        await tester.tap(find.text(label).last);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }
      expect(find.text('FlupFlap account'), findsOneWidget);
      expect(find.textContaining('separate from your TiCash'), findsOneWidget);
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(find.text('Welcome'), findsOneWidget);
      expect(a.requests.every((r) => r.path.startsWith('/flupflap/')), true);
    },
  );
  testWidgets('auth error stays on form without exposing server details', (
    tester,
  ) async {
    final (s, a, _) = fixture();
    await s.initialize();
    a.denied = true;
    await tester.pumpWidget(FlupFlapApp(session: s));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'bad@example.test');
    await tester.enterText(find.byType(TextField).last, 'bad-password');
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Unable to complete'), findsOneWidget);
    expect(s.authenticated, false);
  });
}
