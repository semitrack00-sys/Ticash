import 'package:dio/dio.dart';

import '../config/api_config.dart';
import 'storage_service.dart';

/// Thin wrapper around [Dio] configured with base options and interceptors
/// for attaching JWT access tokens and refreshing them on 401 responses.
class ApiClient {
  ApiClient._internal() {
    _dio = Dio(
      BaseOptions(
        baseUrl: ApiConfig.baseUrl,
        connectTimeout: ApiConfig.connectTimeout,
        receiveTimeout: ApiConfig.receiveTimeout,
        headers: {'Content-Type': 'application/json'},
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await StorageService.instance.accessToken;
          if (token != null) {
            options.headers['Authorization'] = _buildBearerHeader(token);
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          if (error.response?.statusCode == 401) {
            final refreshed = await _refreshAccessToken();
            if (refreshed) {
              final requestOptions = error.requestOptions;
              final token = await StorageService.instance.accessToken;
              if (token != null) {
                requestOptions.headers['Authorization'] =
                    _buildBearerHeader(token);
              }
              try {
                final response = await _dio.fetch(requestOptions);
                return handler.resolve(response);
              } catch (_) {
                // fall through to original error
              }
            }
          }
          handler.next(error);
        },
      ),
    );
  }

  static final ApiClient instance = ApiClient._internal();

  late final Dio _dio;

  Dio get dio => _dio;

  Future<bool> _refreshAccessToken() async {
    final refreshToken = await StorageService.instance.refreshToken;
    if (refreshToken == null) return false;

    try {
      final response = await Dio(BaseOptions(baseUrl: ApiConfig.baseUrl)).post(
        ApiConfig.authRefresh,
        data: {'refreshToken': refreshToken},
      );
      final newAccessToken = response.data['accessToken'] as String;
      final newRefreshToken =
          response.data['refreshToken'] as String? ?? refreshToken;
      await StorageService.instance.saveTokens(
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      );
      return true;
    } catch (_) {
      await StorageService.instance.clearTokens();
      return false;
    }
  }

  static String _buildBearerHeader(String token) {
    const prefix = 'Bearer';
    return '$prefix $token';
  }
}
