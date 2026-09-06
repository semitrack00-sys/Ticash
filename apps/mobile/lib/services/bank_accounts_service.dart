import 'package:dio/dio.dart';

import '../models/bank_account.dart';
import 'api_client.dart';

class BankAccountsService {
  BankAccountsService({Dio? dio}) : _dio = dio ?? ApiClient.instance.dio;

  final Dio _dio;

  Future<List<BankAccount>> list() async {
    final response = await _dio.get('/funding/dwolla/funding-sources');
    final body = response.data as Map<String, dynamic>;
    return (body['fundingSources'] as List<dynamic>)
        .map((item) => BankAccount.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<BankAccount> add({
    required String accountHolderName,
    required String routingNumber,
    required String accountNumber,
    required String accountType,
  }) async {
    await _dio.post(
      '/funding/dwolla/customer',
      data: const <String, dynamic>{},
    );
    final response = await _dio.post(
      '/funding/dwolla/funding-sources',
      data: {
        'name': accountHolderName,
        'routingNumber': routingNumber,
        'accountNumber': accountNumber,
        'bankAccountType': accountType,
      },
    );
    return BankAccount.fromJson(
      (response.data as Map<String, dynamic>)['fundingSource']
          as Map<String, dynamic>,
    );
  }

  Future<BankAccount> startVerification(String id) async {
    final response = await _dio.post(
      '/funding/dwolla/funding-sources/$id/micro-deposits',
    );
    return BankAccount.fromJson(
      (response.data as Map<String, dynamic>)['fundingSource']
          as Map<String, dynamic>,
    );
  }

  Future<BankAccount> verify({
    required String id,
    required String amount1,
    required String amount2,
  }) async {
    final response = await _dio.post(
      '/funding/dwolla/funding-sources/$id/micro-deposits/verify',
      data: {'amount1': amount1, 'amount2': amount2},
    );
    return BankAccount.fromJson(
      (response.data as Map<String, dynamic>)['fundingSource']
          as Map<String, dynamic>,
    );
  }

  Future<BankAccount> setDefault(String id) async {
    final response = await _dio.put(
      '/funding/dwolla/funding-sources/$id/default',
    );
    return BankAccount.fromJson(
      (response.data as Map<String, dynamic>)['fundingSource']
          as Map<String, dynamic>,
    );
  }

  Future<void> remove(String id) async {
    await _dio.delete('/funding/dwolla/funding-sources/$id');
  }
}
