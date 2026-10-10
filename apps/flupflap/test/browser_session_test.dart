import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/session.dart';
import 'flupflap_test.dart' show FixtureAdapter;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'browser startup restores through the existing cookie refresh contract',
    () async {
      final adapter = FixtureAdapter();
      final dio = Dio(BaseOptions(baseUrl: 'https://example.test/api'));
      dio.httpClientAdapter = adapter;
      final storage = BrowserSessionStorage();
      final session = FlupFlapSession(
        dio: dio,
        storage: storage,
        browserSession: true,
      );
      await session.initialize();
      expect(session.authenticated, isTrue);
      expect(adapter.requests.single.path, '/flupflap/auth/refresh');
      expect(adapter.requests.single.data, isEmpty);
      await session.logout();
      expect(session.authenticated, isFalse);
      expect(await storage.read(), isNull);
      expect(adapter.requests.last.path, '/flupflap/auth/logout');
      session.dispose();
    },
  );
  test(
    'native startup still requires secure stored credentials before refresh',
    () async {
      final adapter = FixtureAdapter();
      final dio = Dio(BaseOptions(baseUrl: 'https://example.test/api'));
      dio.httpClientAdapter = adapter;
      final session = FlupFlapSession(
        dio: dio,
        storage: BrowserSessionStorage(),
      );
      await session.initialize();
      expect(session.authenticated, isFalse);
      expect(adapter.requests, isEmpty);
      session.dispose();
    },
  );
  test('browser memory storage is isolated and clears credentials', () async {
    final one = BrowserSessionStorage(), two = BrowserSessionStorage();
    await one.write('fixture-refresh');
    expect(await two.read(), isNull);
    await one.clear();
    expect(await one.read(), isNull);
  });
}
