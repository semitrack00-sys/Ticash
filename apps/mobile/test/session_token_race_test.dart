import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/services/storage_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final storage = StorageService.instance;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    await storage.clearTokens();
  });
  test('refresh arriving after logout cannot restore tokens', () async {
    await storage.saveTokens(accessToken: 'old-access', refreshToken: 'old-refresh');
    final version = storage.tokenVersion;
    await storage.clearTokens();
    expect(await storage.replaceTokensIfCurrent(expectedVersion: version,
      accessToken: 'late-access', refreshToken: 'late-refresh'), isFalse);
    expect(await storage.accessToken, isNull);
    expect(await storage.refreshToken, isNull);
  });
  test('old refresh success or failure cannot overwrite or erase a new login', () async {
    await storage.saveTokens(accessToken: 'old-access', refreshToken: 'old-refresh');
    final version = storage.tokenVersion;
    await storage.saveTokens(accessToken: 'new-access', refreshToken: 'new-refresh');
    expect(await storage.replaceTokensIfCurrent(expectedVersion: version,
      accessToken: 'late-access', refreshToken: 'late-refresh'), isFalse);
    await storage.clearTokens(expectedVersion: version);
    expect(await storage.accessToken, 'new-access');
    expect(await storage.refreshToken, 'new-refresh');
  });
  test('logout invalidates queued token replacement and later login remains intact', () async {
    await storage.saveTokens(accessToken: 'old-access', refreshToken: 'old-refresh');
    final late = storage.replaceTokensIfCurrent(expectedVersion: storage.tokenVersion,
      accessToken: 'late-access', refreshToken: 'late-refresh');
    final clear = storage.clearTokens();
    expect(await late, isFalse);
    await clear;
    expect(await storage.accessToken, isNull);
    await storage.saveTokens(accessToken: 'new-access', refreshToken: 'new-refresh');
    expect(await storage.refreshToken, 'new-refresh');
  });
}
