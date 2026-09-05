import 'package:dio/dio.dart';

import '../config/api_config.dart';
import '../models/transfer.dart';
import 'api_client.dart';

class TransferQuote {
  const TransferQuote({
    required this.quoteId,
    required this.sendAmount,
    required this.exchangeRate,
    required this.ticashFee,
    required this.providerFundingFee,
    required this.recipientAmount,
    required this.totalCustomerCharge,
    required this.expiresAt,
    required this.testMode,
  });

  final String quoteId;
  final double sendAmount;
  final double exchangeRate;
  final double ticashFee;
  final double providerFundingFee;
  final double recipientAmount;
  final double totalCustomerCharge;
  final DateTime expiresAt;
  final bool testMode;

  double get amount => sendAmount;
  double get fee => ticashFee + providerFundingFee;
  double get amountReceived => recipientAmount;
  double get totalCost => totalCustomerCharge;

  factory TransferQuote.fromJson(Map<String, dynamic> json) => TransferQuote(
    quoteId: json['quoteId'] as String,
    sendAmount: (json['sendAmount'] as num).toDouble(),
    exchangeRate: (json['exchangeRate'] as num).toDouble(),
    ticashFee: (json['ticashFee'] as num).toDouble(),
    providerFundingFee: (json['providerFundingFee'] as num).toDouble(),
    recipientAmount: (json['recipientAmount'] as num).toDouble(),
    totalCustomerCharge: (json['totalCustomerCharge'] as num).toDouble(),
    expiresAt: DateTime.parse(json['expiresAt'] as String),
    testMode: json['testMode'] as bool,
  );
}

class TransfersService {
  TransfersService({Dio? dio}) : _dio = dio ?? ApiClient.instance.dio;

  final Dio _dio;

  Future<List<Transfer>> list() async {
    final response = await _dio.get(ApiConfig.transfers);
    final data = response.data is Map<String, dynamic>
        ? response.data['transfers']
        : response.data;
    return (data as List<dynamic>)
        .map((item) => Transfer.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<TransferQuote> quote({
    required Map<String, dynamic> recipient,
    required double amount,
    String amountCurrency = 'USD',
  }) async {
    final response = await _dio.post(
      '${ApiConfig.transfers}/quote',
      data: {
        'recipient': recipient,
        'amount': amount,
        'amountCurrency': amountCurrency,
        'sendCountry': 'US',
        'sourceCurrency': 'USD',
        'targetCurrency': 'HTG',
      },
    );
    final data = response.data as Map<String, dynamic>;
    return TransferQuote.fromJson(
      (data['quote'] as Map<String, dynamic>?) ?? data,
    );
  }

  Future<Transfer> create({
    required Map<String, dynamic> recipient,
    required double amount,
    required String quoteId,
    required String idempotencyKey,
    String amountCurrency = 'USD',
  }) async {
    final response = await _dio.post(
      ApiConfig.transfers,
      data: {
        'recipient': recipient,
        'amount': amount,
        'amountCurrency': amountCurrency,
        'quoteId': quoteId,
        'sendCountry': 'US',
        'sourceCurrency': 'USD',
        'targetCurrency': 'HTG',
      },
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    final data = response.data as Map<String, dynamic>;
    return Transfer.fromJson(
      (data['transfer'] as Map<String, dynamic>?) ?? data,
    );
  }

  Future<Transfer> get(String id) async {
    final response = await _dio.get('${ApiConfig.transfers}/$id');
    return Transfer.fromJson(
      (response.data as Map<String, dynamic>)['transfer']
          as Map<String, dynamic>,
    );
  }

  Future<List<FundingSource>> fundingSources() async {
    final response = await _dio.get('/funding/dwolla/funding-sources');
    return ((response.data as Map<String, dynamic>)['fundingSources']
            as List<dynamic>)
        .map((item) => FundingSource.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> fundTransfer({
    required String transferId,
    required String fundingSourceId,
    required String idempotencyKey,
  }) async {
    await _dio.post(
      '${ApiConfig.transfers}/$transferId/funding',
      data: {'fundingSourceId': fundingSourceId},
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
  }

  Future<List<PayoutChoice>> payoutMethods() async {
    final response = await _dio.get('/payout-methods');
    return ((response.data as Map<String, dynamic>)['methods'] as List<dynamic>)
        .map((item) => PayoutChoice.fromJson(item as Map<String, dynamic>))
        .toList();
  }
}

class FundingSource {
  const FundingSource({
    required this.id,
    required this.name,
    required this.lastFour,
    required this.status,
  });
  final String id;
  final String name;
  final String lastFour;
  final String status;
  factory FundingSource.fromJson(Map<String, dynamic> json) => FundingSource(
    id: json['id'] as String,
    name: json['name'] as String,
    lastFour: json['lastFour'] as String,
    status: json['status'] as String,
  );
}

class PayoutChoice {
  const PayoutChoice({
    required this.id,
    required this.displayName,
    required this.testMode,
  });
  final String id;
  final String displayName;
  final bool testMode;
  factory PayoutChoice.fromJson(Map<String, dynamic> json) => PayoutChoice(
    id: json['id'] as String,
    displayName: json['displayName'] as String,
    testMode: json['testMode'] as bool,
  );
}
