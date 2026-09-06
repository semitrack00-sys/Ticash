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
    try {
      final response = await _dio.post(
        ApiConfig.authLogin,
        data: {'email': email.trim().toLowerCase(), 'password': password},
      );

      await StorageService.instance.saveTokens(
        accessToken: response.data['accessToken'] as String,
        refreshToken: response.data['refreshToken'] as String,
      );

      return User.fromJson(response.data['user'] as Map<String, dynamic>);
    } on DioException catch (error) {
      final data = error.response?.data;
      final message = data is Map<String, dynamic>
          ? data['error'] as String?
          : null;
      throw AuthException(
        message ??
            (error.response == null
                ? 'Cannot reach TiCash. Check the API connection.'
                : 'Unable to sign in. Please try again.'),
      );
    }
  }

  Future<User> register({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    required String countryCode,
    required String addressLine1,
    String? addressLine2,
    required String city,
    String? region,
    String? postalCode,
  }) async {
    try {
      final response = await _dio.post(
        ApiConfig.authRegister,
        data: {
          'email': email.trim().toLowerCase(),
          'password': password,
          'firstName': firstName.trim(),
          'lastName': lastName.trim(),
          'countryCode': countryCode.trim().toUpperCase(),
          'addressLine1': addressLine1.trim(),
          'addressLine2': addressLine2?.trim().isEmpty == true
              ? null
              : addressLine2?.trim(),
          'city': city.trim(),
          'region': region?.trim().isEmpty == true ? null : region?.trim(),
          'postalCode': postalCode?.trim().isEmpty == true
              ? null
              : postalCode?.trim(),
        },
      );

      await StorageService.instance.saveTokens(
        accessToken: response.data['accessToken'] as String,
        refreshToken: response.data['refreshToken'] as String,
      );

      return User.fromJson(response.data['user'] as Map<String, dynamic>);
    } on DioException catch (error) {
      throw AuthException(
        _messageFor(
          error,
          fallback: 'Unable to create your account. Please try again.',
        ),
      );
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      await _dio.put(
        '${ApiConfig.users}/me/password',
        data: {'currentPassword': currentPassword, 'newPassword': newPassword},
      );
    } on DioException catch (error) {
      throw AuthException(
        _messageFor(
          error,
          fallback: 'Unable to change your password. Please try again.',
        ),
      );
    }
  }

  Future<User> updateProfile({
    required String firstName,
    required String lastName,
    String? phoneNumber,
    String? countryCode,
    String? addressLine1,
    String? addressLine2,
    String? city,
    String? region,
    String? postalCode,
  }) async {
    try {
      final response = await _dio.patch(
        '${ApiConfig.users}/me',
        data: {
          'firstName': firstName.trim(),
          'lastName': lastName.trim(),
          'phoneNumber': phoneNumber?.trim().isEmpty == true
              ? null
              : phoneNumber?.trim(),
          'countryCode': countryCode?.trim().isEmpty == true
              ? null
              : countryCode?.trim().toUpperCase(),
          'addressLine1': addressLine1?.trim().isEmpty == true
              ? null
              : addressLine1?.trim(),
          'addressLine2': addressLine2?.trim().isEmpty == true
              ? null
              : addressLine2?.trim(),
          'city': city?.trim().isEmpty == true ? null : city?.trim(),
          'region': region?.trim().isEmpty == true ? null : region?.trim(),
          'postalCode': postalCode?.trim().isEmpty == true
              ? null
              : postalCode?.trim(),
        },
      );
      return User.fromJson(response.data['user'] as Map<String, dynamic>);
    } on DioException catch (error) {
      throw AuthException(
        _messageFor(
          error,
          fallback: 'Unable to update your profile. Please try again.',
        ),
      );
    }
  }

  Future<User> requestKycReview() async {
    try {
      final response = await _dio.post(
        '${ApiConfig.kyc}/submit',
        data: {'attested': true},
      );
      return User.fromJson(response.data['user'] as Map<String, dynamic>);
    } on DioException catch (error) {
      throw AuthException(
        _messageFor(
          error,
          fallback: 'Unable to request identity review. Please try again.',
        ),
      );
    }
  }

  String _messageFor(DioException error, {required String fallback}) {
    final data = error.response?.data;
    final serverMessage = data is Map<String, dynamic>
        ? data['error'] as String?
        : null;
    if (serverMessage != null && serverMessage.isNotEmpty) return serverMessage;
    if (error.response == null) {
      return 'Cannot reach TiCash. Make sure the API is running and try again.';
    }
    return fallback;
  }

  Future<bool> isLoggedIn() async {
    final token = await StorageService.instance.accessToken;
    return token != null;
  }

  Future<User> getCurrentUser() async {
    try {
      final response = await _dio.get('${ApiConfig.users}/me');
      final data = response.data as Map<String, dynamic>;
      return User.fromJson((data['user'] as Map<String, dynamic>?) ?? data);
    } on DioException catch (error) {
      throw AuthException(
        _messageFor(
          error,
          fallback: 'Unable to refresh your account. Please try again.',
        ),
      );
    }
  }

  Future<User?> restoreSession() async {
    if (!await isLoggedIn()) return null;
    try {
      return await getCurrentUser();
    } catch (_) {
      await StorageService.instance.clearTokens();
      return null;
    }
  }

  Future<void> logout() async {
    final refreshToken = await StorageService.instance.refreshToken;
    try {
      await _dio.post(
        ApiConfig.authLogout,
        data: {'refreshToken': refreshToken},
      );
    } catch (_) {
      // Ignore network errors on logout; always clear local tokens.
    } finally {
      await StorageService.instance.clearTokens();
    }
  }
}

class AuthException implements Exception {
  const AuthException(this.message);
  final String message;

  @override
  String toString() => message;
}
