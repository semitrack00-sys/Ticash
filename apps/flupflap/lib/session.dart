import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:ticash/services/trusted_api_transport.dart';

abstract interface class SessionStorage {
  Future<String?> read();
  Future<void> write(String value);
  Future<void> clear();
}

class SecureSessionStorage implements SessionStorage {
  final FlutterSecureStorage storage = const FlutterSecureStorage();
  static const key = 'flupflap.refresh.v1';
  @override
  Future<String?> read() => storage.read(key: key);
  @override
  Future<void> write(String value) => storage.write(key: key, value: value);
  @override
  Future<void> clear() => storage.delete(key: key);
}

/// Own client, token namespace and session. No TiCash ApiClient or auth provider.
class FlupFlapSession extends ChangeNotifier {
  FlupFlapSession({required this.dio, required this.storage}) {
    final trustedBaseUrl = dio.options.baseUrl;
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
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
            handler.reject(DioException(requestOptions: options,
              type: DioExceptionType.cancel, message: 'Session changed'));
            return;
          }
          options.extra['sessionEpoch'] = _epoch;
          for (final key in options.headers.keys
              .where((key) => key.toLowerCase() == 'authorization').toList()) {
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
  final Dio dio;
  final SessionStorage storage;
  Map<String, dynamic>? user;
  String? _accessToken;
  Future<void>? _refreshing;
  int _epoch = 0;
  bool _loggingOut = false;
  Future<void>? _storageWork;
  bool ready = false;
  bool get authenticated => user != null && _accessToken != null;
  bool get guest => user?['guest'] == true;
  Future<void> initialize() async {
    final epoch = _epoch;
    try {
      if (await storage.read() != null) await refresh();
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
        data['accessToken'] is! String ||
        data['refreshToken'] is! String) {
      throw const FormatException('Invalid FlupFlap session');
    }
    await _queueStorage(() async {
      if (epoch == _epoch && !_loggingOut) {
        await storage.write(data['refreshToken'] as String);
      }
    });
    if (epoch != _epoch || _loggingOut) throw StateError('Session changed');
    user = customer;
    _accessToken = data['accessToken'] as String;
    notifyListeners();
  }

  Future<void> _authenticate(String route, Map<String, dynamic> body) async {
    final epoch = ++_epoch;
    await _accept(
      (await dio.post('/flupflap/auth/$route', data: body)).data,
      epoch,
    );
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
  Future<void> enterGuest() => _authenticate('guest', {});
  Future<void> refresh() {
    if (_loggingOut) return Future.error(StateError('Signing out'));
    return _refreshing ??= _refresh().whenComplete(() => _refreshing = null);
  }

  Future<void> _refresh() async {
    final epoch = _epoch;
    final value = await storage.read();
    if (value == null || epoch != _epoch) throw StateError('Sign in required');
    await _accept(
      (await dio.post(
        '/flupflap/auth/refresh',
        data: {'refreshToken': value},
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

  Future<void> clear() async {
    _epoch++;
    _accessToken = null;
    user = null;
    notifyListeners();
    await _queueStorage(storage.clear);
  }
}
