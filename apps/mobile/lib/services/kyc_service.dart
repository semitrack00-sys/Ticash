import 'package:dio/dio.dart';

import '../config/api_config.dart';
import '../models/kyc.dart';
import 'api_client.dart';

class KycService {
  KycService({Dio? dio}) : _dio = dio ?? ApiClient.instance.dio;

  final Dio _dio;

  Future<KycSession> createSession() async {
    try {
      final response = await _dio.post('${ApiConfig.kyc}/session');
      return KycSession.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (error) {
      throw KycException(
        _messageFor(
          error,
          fallback: 'Unable to start identity verification. Please try again.',
        ),
      );
    }
  }

  Future<KycStatusSnapshot> getStatus({bool refresh = false}) async {
    try {
      final response = await _dio.get(
        '${ApiConfig.kyc}/status',
        queryParameters: refresh ? {'refresh': 'true'} : null,
      );
      return KycStatusSnapshot.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (error) {
      throw KycException(
        _messageFor(
          error,
          fallback: 'Unable to refresh your verification status.',
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
    return error.response == null
        ? 'Cannot reach TiCash. Check your connection and try again.'
        : fallback;
  }
}

class KycException implements Exception {
  const KycException(this.message);

  final String message;

  @override
  String toString() => message;
}
