import 'package:dio/dio.dart';

import '../models/mobile_top_up.dart';
import 'api_client.dart';

class MobileTopUpService {
  MobileTopUpService({Dio? dio}) : _dio = dio ?? ApiClient.instance.dio;
  final Dio _dio;
  static const _base = '/mobile-topups';

  String _countryCode(String value) {
    final normalized = value.trim().toUpperCase();
    if (!RegExp(r'^[A-Z]{2}$').hasMatch(normalized)) {
      throw ArgumentError.value(
        value,
        'countryCode',
        'Mobile Recharge requires a two-letter destination country code.',
      );
    }
    return normalized;
  }

  Future<MobileTopUpAvailability> availability() async =>
      MobileTopUpAvailability.fromJson(
        (await _dio.get('$_base/status')).data as Map<String, dynamic>,
      );

  Future<List<MobileTopUpCountry>> countries() async {
    final data =
        (await _dio.get('$_base/countries')).data as Map<String, dynamic>;
    return (data['countries'] as List)
        .map(
          (item) => MobileTopUpCountry.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  Future<List<MobileTopUpOperator>> operators(String countryCode) async {
    final normalizedCountryCode = _countryCode(countryCode);
    final data =
        (await _dio.get(
              '$_base/operators',
              queryParameters: {'country': normalizedCountryCode},
            )).data
            as Map<String, dynamic>;
    return (data['operators'] as List)
        .map(
          (item) => MobileTopUpOperator.fromJson({
            'countryCode': normalizedCountryCode,
            ...(item as Map<String, dynamic>),
          }),
        )
        .toList();
  }

  Future<MobileTopUpOperator> detectOperator({
    required String countryCode,
    required String phone,
  }) async {
    final normalizedCountryCode = _countryCode(countryCode);
    final data =
        (await _dio.get(
              '$_base/operators/detect',
              queryParameters: {
                'country': normalizedCountryCode,
                'phone': phone,
              },
            )).data
            as Map<String, dynamic>;
    return MobileTopUpOperator.fromJson(
      {
        'countryCode': normalizedCountryCode,
        ...(data['operator'] as Map<String, dynamic>),
      },
    );
  }

  Future<List<MobileTopUpProduct>> products(String countryCode, int operatorId) async {
    final data =
        (await _dio.get(
              '$_base/operators/$operatorId/products',
              queryParameters: {'country': _countryCode(countryCode)},
            )).data
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
    required String countryCode,
    MobileTopUpOperator? operator,
  }) async {
    final data =
        (await _dio.post(
              '$_base/recipients',
              data: {
                'nickname': nickname,
                'phone': phone,
                'countryCode': _countryCode(countryCode),
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
    required String countryCode,
    required String phone,
    required int operatorId,
    required String productId,
    double? amount,
  }) async {
    final data =
        (await _dio.post(
              '$_base/quotes',
              data: {
                'countryCode': _countryCode(countryCode),
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
