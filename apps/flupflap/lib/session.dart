import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:ticash_recharge_core/services/trusted_api_transport.dart';

abstract interface class SessionStorage {
  Future<String?> read();
  Future<void> write(String value);
  Future<void> clear();
}

class SecureSessionStorage implements SessionStorage {
  SecureSessionStorage({this.key = 'flupflap.refresh.v1'});
  final FlutterSecureStorage storage = const FlutterSecureStorage();
  final String key;
  @override
  Future<String?> read() => storage.read(key: key);
  @override
  Future<void> write(String value) => storage.write(key: key, value: value);
  @override
  Future<void> clear() => storage.delete(key: key);
}

/// Browser credentials are memory-only, matching the existing FlupFlap website.
/// Browser storage and service-worker caches never receive authentication tokens.
class BrowserSessionStorage implements SessionStorage {
  String? _refreshToken;
  @override
  Future<String?> read() async => _refreshToken;
  @override
  Future<void> write(String value) async {
    _refreshToken = value;
  }

  @override
  Future<void> clear() async {
    _refreshToken = null;
  }
}

/// Own client, token namespace and session. No TiCash ApiClient or auth provider.
class FlupFlapSession extends ChangeNotifier {
  FlupFlapSession({
    required this.dio,
    required this.storage,
    this.browserSession = false,
    this.deviceIdProvider,
    this.trustedDeviceStorage,
  }) {
    final trustedBaseUrl = dio.options.baseUrl;
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.extra['expectedSessionEpoch'] != null &&
              options.extra['expectedSessionEpoch'] != _epoch) {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.cancel,
                message: 'Session changed',
              ),
            );
            return;
          }
          // Fail closed if a reused screen attempts a TiCash API or absolute URL.
          if (!options.path.startsWith('/flupflap/') ||
              options.path.contains('..') ||
              options.path.contains('%') ||
              !isTrustedApiRequest(options, trustedBaseUrl)) {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.cancel,
                message: 'FlupFlap endpoint required',
              ),
            );
            return;
          }
          options.followRedirects = false;
          if (options.extra['retried'] == true &&
              options.extra['sessionEpoch'] != _epoch) {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.cancel,
                message: 'Session changed',
              ),
            );
            return;
          }
          options.extra['sessionEpoch'] = _epoch;
          for (final key
              in options.headers.keys
                  .where(
                    (key) => key.toLowerCase() == 'x-flupflap-trusted-device',
                  )
                  .toList()) {
            options.headers.remove(key);
          }
          if (options.path.startsWith('/flupflap/auth/login')) {
            final trusted =
                _trustedDeviceToken ?? await trustedDeviceStorage?.read();
            if (trusted != null)
              options.headers['X-FlupFlap-Trusted-Device'] = trusted;
          }
          if (deviceIdProvider != null) {
            try {
              options.headers['X-FlupFlap-Device'] =
                  await (_deviceIdentifier ??= deviceIdProvider!());
            } catch (_) {
              _deviceIdentifier = null;
              // Existing payment controls remain active if secure storage fails.
            }
          }
          if (options.extra['sessionEpoch'] != _epoch) {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.cancel,
                message: 'Session changed',
              ),
            );
            return;
          }
          for (final key
              in options.headers.keys
                  .where((key) => key.toLowerCase() == 'authorization')
                  .toList()) {
            options.headers.remove(key);
          }
          if (_accessToken != null) {
            options.headers['Authorization'] = 'Bearer $_accessToken';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final request = error.requestOptions;
          if (error.response?.statusCode == 401 &&
              request.extra['sessionEpoch'] == _epoch &&
              !request.path.startsWith('/flupflap/auth/') &&
              request.extra['retried'] != true) {
            final epoch = _epoch;
            try {
              await refresh();
              request.extra['retried'] = true;
              handler.resolve(await dio.fetch<dynamic>(request));
              return;
            } catch (_) {
              if (epoch == _epoch) {
                await clear();
              }
            }
          }
          handler.next(error);
        },
      ),
    );
  }
  Future<String>? _deviceIdentifier;
  final Future<String> Function()? deviceIdProvider;
  final Dio dio;
  final SessionStorage storage;
  final SessionStorage? trustedDeviceStorage;
  String? _trustedDeviceToken;
  String? loginChallengeId, loginEmail, securityNotice;
  final bool browserSession;
  Map<String, dynamic>? user;
  String? _accessToken;
  Future<void>? _refreshing;
  int _epoch = 0;
  bool _loggingOut = false;
  Future<void>? _storageWork;
  bool ready = false;
  String? deletionNotice;
  bool get authenticated => user != null && _accessToken != null && !guest;
  bool get guest => user?['guest'] == true;
  Future<void> initialize() async {
    final epoch = _epoch;
    try {
      if (browserSession || await storage.read() != null) await refresh();
    } catch (_) {
      if (epoch == _epoch) {
        await clear();
      }
    } finally {
      ready = true;
      notifyListeners();
    }
  }

  Future<void> _queueStorage(Future<void> Function() action) {
    final next = _storageWork == null
        ? Future<void>.sync(action)
        : _storageWork!.then((_) => action());
    _storageWork = next.catchError((Object _) {});
    return next;
  }

  Future<void> _accept(dynamic value, int epoch) async {
    if (epoch != _epoch || _loggingOut) throw StateError('Session changed');
    final data = Map<String, dynamic>.from(value as Map);
    final customer = Map<String, dynamic>.from(data['user'] as Map);
    if (customer['domain'] != 'FLUPFLAP' ||
        customer['guest'] == true ||
        data['guest'] == true ||
        data['accessToken'] is! String ||
        data['refreshToken'] is! String) {
      throw const FormatException('Invalid FlupFlap session');
    }
    await _queueStorage(() async {
      if (epoch == _epoch && !_loggingOut) {
        await storage.write(data['refreshToken'] as String);
        if (data['trustedDeviceToken'] is String) {
          await trustedDeviceStorage?.write(
            data['trustedDeviceToken'] as String,
          );
          _trustedDeviceToken = data['trustedDeviceToken'] as String;
        }
      }
    });
    if (epoch != _epoch || _loggingOut) throw StateError('Session changed');
    user = customer;
    loginChallengeId = null;
    loginEmail = null;
    deletionNotice = null;
    _accessToken = data['accessToken'] as String;
    notifyListeners();
  }

  Future<void> _authenticate(String route, Map<String, dynamic> body) async {
    final epoch = ++_epoch;
    final data = (await dio.post('/flupflap/auth/$route', data: body)).data;
    if (epoch != _epoch) throw StateError('Session changed');
    if (route == 'login' &&
        data is Map &&
        data['code'] == 'LOGIN_VERIFICATION_REQUIRED' &&
        data['challengeId'] is String) {
      await _queueStorage(storage.clear);
      if (epoch != _epoch) throw StateError('Session changed');
      loginChallengeId = data['challengeId'] as String;
      loginEmail = body['email'] as String;
      user = null;
      _accessToken = null;
      notifyListeners();
      return;
    }
    await _accept(data, epoch);
  }

  Future<void> confirmLogin(String code) async {
    if (loginChallengeId == null || loginEmail == null)
      throw StateError('Sign in again');
    await _authenticate('login/confirm', {
      'email': loginEmail,
      'challengeId': loginChallengeId,
      'code': code,
    });
  }

  void cancelLoginChallenge() {
    _epoch++;
    loginChallengeId = null;
    loginEmail = null;
    notifyListeners();
  }

  Future<void> signOutAll(String password) async {
    await dio.post(
      '/flupflap/auth/sessions/revoke-all',
      data: {'password': password},
    );
    await trustedDeviceStorage?.clear();
    _trustedDeviceToken = null;
    securityNotice = 'signedOutAll';
    await clear();
  }

  Future<void> securityChanged(String notice) async {
    await trustedDeviceStorage?.clear();
    _trustedDeviceToken = null;
    securityNotice = notice;
    await clear();
  }

  Future<void> login(String email, String password) =>
      _authenticate('login', {'email': email, 'password': password});
  Future<void> register({
    required String firstName,
    required String lastName,
    required String phone,
    required String email,
    required String password,
  }) => _authenticate('register', {
    'firstName': firstName,
    'lastName': lastName,
    'phone': phone,
    'email': email,
    'password': password,
  });
  Future<void> refresh() {
    if (_loggingOut) return Future.error(StateError('Signing out'));
    return _refreshing ??= _refresh().whenComplete(() => _refreshing = null);
  }

  Future<void> _refresh() async {
    final epoch = _epoch;
    final value = await storage.read();
    if ((value == null && !browserSession) || epoch != _epoch) {
      throw StateError('Sign in required');
    }
    await _accept(
      (await dio.post(
        '/flupflap/auth/refresh',
        data: value == null && browserSession
            ? <String, dynamic>{}
            : {'refreshToken': value},
      )).data,
      epoch,
    );
  }

  Future<void> forgot(String email) async {
    await dio.post('/flupflap/auth/forgot-password', data: {'email': email});
  }

  Future<void> reset(String token, String password) async {
    await dio.post(
      '/flupflap/auth/reset-password',
      data: {'token': token, 'password': password},
    );
    await clear();
  }

  Future<void> country(String value) async {
    final epoch = _epoch;
    final response = await dio.patch(
      '/flupflap/auth/me',
      data: {'countryCode': value},
    );
    if (epoch != _epoch || !authenticated) return;
    user = Map<String, dynamic>.from((response.data as Map)['user'] as Map);
    notifyListeners();
  }

  Future<void> logout() async {
    _loggingOut = true;
    _epoch++;
    try {
      await dio.post('/flupflap/auth/logout');
    } finally {
      await clear();
      _loggingOut = false;
    }
  }

  Future<String> deleteAccount(String password) async {
    if (!authenticated || guest)
      throw StateError('Registered account required');
    final epoch = _epoch;
    // Refresh is not password verification. The server separately verifies the
    // supplied password and binds deletion to this authenticated customer only.
    await refresh();
    if (epoch != _epoch || !authenticated || guest)
      throw StateError('Session changed');
    final response = await dio.post(
      '/flupflap/auth/account-deletion',
      data: {'password': password, 'confirm': 'DELETE_ACCOUNT'},
      options: Options(extra: {'expectedSessionEpoch': epoch}),
    );
    final data = Map<String, dynamic>.from(response.data as Map);
    final status = data['status'];
    if (data['requestId'] is! String ||
        !const {'DELETION_PENDING', 'LOCAL_DATA_DELETED'}.contains(status)) {
      throw const FormatException('Invalid account deletion response');
    }
    if (epoch != _epoch) return status as String;
    deletionNotice = status == 'LOCAL_DATA_DELETED'
        ? 'Your account and eligible personal data have been deleted. Required transaction and security records may be retained.'
        : 'Your deletion request has been accepted. Account access and future automatic recharges are stopped. Personal data deletion will finish after pending payment work is resolved.';
    await clear();
    return status as String;
  }

  Future<void> clear() async {
    _epoch++;
    _accessToken = null;
    user = null;
    loginChallengeId = null;
    loginEmail = null;
    notifyListeners();
    await _queueStorage(storage.clear);
  }
}

Future<String> loadDeviceIdentifier() async {
  const secure = FlutterSecureStorage();
  const deviceKey = 'flupflap.security.device.v1';
  final saved = await secure.read(key: deviceKey);
  if (saved != null && RegExp(r'^[a-f0-9]{64}$').hasMatch(saved)) return saved;
  final random = Random.secure();
  final value = List.generate(
    32,
    (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
  await secure.write(key: deviceKey, value: value);
  return value;
}
