import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/providers/auth_provider.dart';
import 'package:ticash/services/auth_service.dart';
import 'package:ticash/services/storage_service.dart';

class RaceAdapter implements HttpClientAdapter {
  RaceAdapter(this.respond);
  final Future<ResponseBody> Function(RequestOptions) respond;
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? stream,
      Future<void>? cancel) => respond(options);
  @override
  void close({bool force = false}) {}
}

ResponseBody signedIn(String id) => ResponseBody.fromString(jsonEncode({
  'accessToken': '$id-access', 'refreshToken': '$id-refresh',
  'user': {'id': id, 'email': '$id@example.test', 'firstName': 'Test',
    'lastName': 'Customer', 'createdAt': '2026-01-01T00:00:00Z'},
}), 200, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final storage = StorageService.instance;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await storage.clearTokens();
  });
  for (final register in [false, true]) {
    test('late ${register ? 'registration' : 'login'} cannot restore a logged-out session', () async {
      final started = Completer<void>(), reply = Completer<ResponseBody>();
      final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
        ..httpClientAdapter = RaceAdapter((request) async {
          if (request.path.endsWith('/logout')) return ResponseBody.fromString('', 204);
          started.complete();
          return reply.future;
        });
      final service = AuthService(dio: dio);
      final pending = register ? service.register(email: 'old@example.test', password: 'test-password',
        firstName: 'Test', lastName: 'Customer', countryCode: 'US', addressLine1: '1 Main', city: 'Boston')
        : service.login(email: 'old@example.test', password: 'test-password');
      final rejected = expectLater(pending, throwsA(isA<AuthException>()));
      await started.future;
      await service.logout();
      reply.complete(signedIn('old'));
      await rejected;
      expect(await storage.accessToken, isNull);
      expect(await storage.refreshToken, isNull);
    });
  }
  test('slow logout does not erase a newer login or overwrite its account UI', () async {
    await storage.saveTokens(accessToken: 'old-access', refreshToken: 'old-refresh');
    final logoutStarted = Completer<void>(), logoutReply = Completer<ResponseBody>();
    String? revokedToken;
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
      ..httpClientAdapter = RaceAdapter((request) async {
        if (request.path.endsWith('/logout')) {
          revokedToken = (request.data as Map)['refreshToken'] as String?;
          logoutStarted.complete();
          return logoutReply.future;
        }
        return signedIn('new');
      });
    final notifier = AuthNotifier(AuthService(dio: dio));
    await Future<void>.delayed(Duration.zero);
    final logout = notifier.logout();
    await logoutStarted.future;
    expect(await storage.accessToken, isNull);
    await notifier.login('new@example.test', 'test-password');
    logoutReply.complete(ResponseBody.fromString('', 204));
    await logout;
    expect(revokedToken, 'old-refresh');
    expect(await storage.accessToken, 'new-access');
    expect(notifier.state.valueOrNull?.id, 'new');
    notifier.dispose();
  });
  test('older sign-in completion cannot overwrite a newer account', () async {
    final oldStarted = Completer<void>(), oldReply = Completer<ResponseBody>();
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
      ..httpClientAdapter = RaceAdapter((request) async {
        if ((request.data as Map)['email'] == 'old@example.test') {
          oldStarted.complete();
          return oldReply.future;
        }
        return signedIn('new');
      });
    final notifier = AuthNotifier(AuthService(dio: dio));
    await Future<void>.delayed(Duration.zero);
    final old = notifier.login('old@example.test', 'test-password');
    await oldStarted.future;
    await notifier.login('new@example.test', 'test-password');
    oldReply.complete(signedIn('old'));
    await old;
    expect(await storage.accessToken, 'new-access');
    expect(notifier.state.valueOrNull?.id, 'new');
    notifier.dispose();
  });
}
