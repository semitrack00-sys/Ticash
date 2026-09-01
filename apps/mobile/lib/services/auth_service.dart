import 'package:dio/dio.dart';

import '../config/api_config.dart';
import '../models/user.dart';
import 'api_client.dart';
import 'storage_service.dart';

/// Handles authentication flows: login, registration, logout, and session
/// bootstrapping.
class AuthService {
  AuthService({Dio? dio}) : _dio = dio ?? ApiClient.instance.dio;

  final Dio _dio;

  Future<User> login({required String email, required String password}) async {
    final response = await _dio.post(
      ApiConfig.authLogin,
      data: {'email': email, 'password': password},
    );

    await StorageService.instance.saveTokens(
      accessToken: response.data['accessToken'] as String,
      refreshToken: response.data['refreshToken'] as String,
    );

    return User.fromJson(response.data['user'] as Map<String, dynamic>);
  }

  Future<User> register({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
  }) async {
    final response = await _dio.post(
      ApiConfig.authRegister,
      data: {
        'email': email,
        'password': password,
        'firstName': firstName,
        'lastName': lastName,
      },
    );

    await StorageService.instance.saveTokens(
      accessToken: response.data['accessToken'] as String,
      refreshToken: response.data['refreshToken'] as String,
    );

    return User.fromJson(response.data['user'] as Map<String, dynamic>);
  }

  Future<bool> isLoggedIn() async {
    final token = await StorageService.instance.accessToken;
    return token != null;
  }

  Future<void> logout() async {
    try {
      await _dio.post(ApiConfig.authLogout);
    } catch (_) {
      // Ignore network errors on logout; always clear local tokens.
    } finally {
      await StorageService.instance.clearTokens();
    }
  }
}
