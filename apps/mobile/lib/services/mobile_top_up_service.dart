import 'package:dio/dio.dart';

import '../models/mobile_top_up.dart';
import 'api_client.dart';

class MobileTopUpService {
  MobileTopUpService({Dio? dio}) : _dio = dio ?? ApiClient.instance.dio;
  final Dio _dio;
  static const _base = '/mobile-topups';

  Future<MobileTopUpAvailability> availability() async =>
      MobileTopUpAvailability.fromJson(
        (await _dio.get('$_base/status')).data as Map<String, dynamic>,
      );
  Future<List<MobileTopUpOperator>> operators() async {
    final data =
        (await _dio.get(
              '$_base/operators',
              queryParameters: {'country': 'HT'},
            )).data
            as Map<String, dynamic>;
    return (data['operators'] as List)
        .map(
          (item) => MobileTopUpOperator.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<MobileTopUpOperator> detectOperator(String phone) async {
    final data =
        (await _dio.get(
              '$_base/operators/detect',
              queryParameters: {'phone': phone},
            )).data
            as Map<String, dynamic>;
    return MobileTopUpOperator.fromJson(
      data['operator'] as Map<String, dynamic>,
    );
  }

  Future<List<MobileTopUpProduct>> products(int operatorId) async {
    final data =
        (await _dio.get('$_base/operators/$operatorId/products')).data
            as Map<String, dynamic>;
    return (data['products'] as List)
        .map(
          (item) => MobileTopUpProduct.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<List<MobileTopUpRecipient>> recipients() async {
    final data =
        (await _dio.get('$_base/recipients')).data as Map<String, dynamic>;
    return (data['recipients'] as List)
        .map(
          (item) => MobileTopUpRecipient.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<MobileTopUpRecipient> saveRecipient({
    required String nickname,
    required String phone,
    MobileTopUpOperator? operator,
  }) async {
    final data =
        (await _dio.post(
              '$_base/recipients',
              data: {
                'nickname': nickname,
                'phone': phone,
                if (operator != null) 'operatorId': operator.id,
                if (operator != null) 'operatorName': operator.name,
              },
            )).data
            as Map<String, dynamic>;
    return MobileTopUpRecipient.fromJson(
      data['recipient'] as Map<String, dynamic>,
    );
  }

  Future<MobileTopUpQuote> quote({
    required String phone,
    required int operatorId,
    required String productId,
    double? amount,
  }) async {
    final data =
        (await _dio.post(
              '$_base/quotes',
              data: {
                'phone': phone,
                'operatorId': operatorId,
                'productId': productId,
                if (amount != null) 'amount': amount,
              },
            )).data
            as Map<String, dynamic>;
    return MobileTopUpQuote.fromJson(data['quote'] as Map<String, dynamic>);
  }

  Future<MobileTopUpTransaction> purchase({
    required String quoteId,
    required String idempotencyKey,
    String? recipientId,
  }) async {
    final data =
        (await _dio.post(
              '$_base/transactions',
              data: {
                'quoteId': quoteId,
                if (recipientId != null) 'recipientId': recipientId,
              },
              options: Options(headers: {'Idempotency-Key': idempotencyKey}),
            )).data
            as Map<String, dynamic>;
    return MobileTopUpTransaction.fromJson(
      data['transaction'] as Map<String, dynamic>,
    );
  }

  Future<List<MobileTopUpTransaction>> history() async {
    final data =
        (await _dio.get('$_base/transactions')).data as Map<String, dynamic>;
    return (data['transactions'] as List)
        .map(
          (item) =>
              MobileTopUpTransaction.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<MobileTopUpTransaction> transaction(
    String id, {
    bool refresh = false,
  }) async {
    final data =
        (await _dio.get(
              '$_base/transactions/$id',
              queryParameters: {'refresh': refresh},
            )).data
            as Map<String, dynamic>;
    return MobileTopUpTransaction.fromJson(
      data['transaction'] as Map<String, dynamic>,
    );
  }

  Future<MobileTopUpQuote> repeat(String id) async {
    final data =
        (await _dio.post('$_base/transactions/$id/repeat')).data
            as Map<String, dynamic>;
    return MobileTopUpQuote.fromJson(data['quote'] as Map<String, dynamic>);
  }
}
