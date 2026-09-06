import 'package:dio/dio.dart';

import '../config/api_config.dart';
import '../models/recipient.dart';
import 'api_client.dart';

class RecipientsService {
  RecipientsService({Dio? dio}) : _dio = dio ?? ApiClient.instance.dio;

  final Dio _dio;

  Future<List<Recipient>> list() async {
    final response = await _dio.get(ApiConfig.recipients);
    final data = response.data is Map<String, dynamic>
        ? response.data['recipients']
        : response.data;
    return (data as List<dynamic>)
        .map((item) => Recipient.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Recipient> create({
    required String firstName,
    String? middleName,
    required String lastName,
    required String phoneNumber,
    required String payoutMethod,
    required String address,
    required String city,
    required String department,
  }) async {
    final response = await _dio.post(
      ApiConfig.recipients,
      data: {
        'firstName': firstName,
        'middleName': middleName,
        'lastName': lastName,
        'country': 'HT',
        'phoneNumber': phoneNumber,
        'payoutMethod': payoutMethod,
        'address': address,
        'city': city,
        'department': department,
      },
    );
    final data = response.data as Map<String, dynamic>;
    return Recipient.fromJson(
      (data['recipient'] as Map<String, dynamic>?) ?? data,
    );
  }

  Future<void> delete(String recipientId) async {
    await _dio.delete('${ApiConfig.recipients}/$recipientId');
  }

  Future<Recipient> update({
    required String recipientId,
    required String firstName,
    String? middleName,
    required String lastName,
    required String phoneNumber,
    required String payoutMethod,
    required String address,
    required String city,
    required String department,
  }) async {
    final response = await _dio.patch(
      '${ApiConfig.recipients}/$recipientId',
      data: {
        'firstName': firstName,
        'middleName': middleName,
        'lastName': lastName,
        'country': 'HT',
        'phoneNumber': phoneNumber,
        'payoutMethod': payoutMethod,
        'address': address,
        'city': city,
        'department': department,
      },
    );
    final data = response.data as Map<String, dynamic>;
    return Recipient.fromJson(
      (data['recipient'] as Map<String, dynamic>?) ?? data,
    );
  }
}
