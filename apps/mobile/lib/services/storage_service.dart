import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Wrapper around [FlutterSecureStorage] for persisting sensitive data such
/// as JWT access/refresh tokens.
class StorageService {
  StorageService._();

  static final StorageService instance = StorageService._();

  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const _accessTokenKey = 'ticash_access_token';
  static const _refreshTokenKey = 'ticash_refresh_token';
  static const _languageCodeKey = 'ticash_language_code';
  int _tokenVersion = 0;
  Future<void> _tokenWork = Future<void>.value();
  int get tokenVersion => _tokenVersion;

  Future<T> _mutateTokens<T>(Future<T> Function() operation) {
    final work = _tokenWork.then((_) => operation());
    _tokenWork = work.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return work;
  }

  Future<void> init() async {
    // Reserved for future secure-storage migrations.
  }

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) {
    final version = ++_tokenVersion;
    return _mutateTokens(() async {
      if (version != _tokenVersion) {
        return;
      }
      await _secureStorage.write(key: _accessTokenKey, value: accessToken);
      await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
    });
  }

  Future<bool> replaceTokensIfCurrent({
    required int expectedVersion,
    required String accessToken,
    required String refreshToken,
  }) => _mutateTokens(() async {
    if (expectedVersion != _tokenVersion) {
      return false;
    }
    final version = ++_tokenVersion;
    try {
      await _secureStorage.write(key: _accessTokenKey, value: accessToken);
      await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
    } catch (_) {
      if (version == _tokenVersion) {
        await Future.wait([
          _secureStorage.delete(key: _accessTokenKey),
          _secureStorage.delete(key: _refreshTokenKey),
        ]);
      }
      rethrow;
    }
    return version == _tokenVersion;
  });

  Future<String?> get accessToken => _secureStorage.read(key: _accessTokenKey);

  Future<String?> get refreshToken =>
      _secureStorage.read(key: _refreshTokenKey);

  Future<void> clearTokens({int? expectedVersion}) {
    if (expectedVersion != null && expectedVersion != _tokenVersion) {
      return Future<void>.value();
    }
    _tokenVersion++;
    return _mutateTokens(() async {
      await _secureStorage.delete(key: _accessTokenKey);
      await _secureStorage.delete(key: _refreshTokenKey);
    });
  }

  Future<String?> get languageCode =>
      _secureStorage.read(key: _languageCodeKey);

  Future<void> saveLanguageCode(String code) =>
      _secureStorage.write(key: _languageCodeKey, value: code);
}
