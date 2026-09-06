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
    required this.sourceCurrency,
    required this.targetCurrency,
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
  final String sourceCurrency;
  final String targetCurrency;

  double get amount => sendAmount;
  double get fee => ticashFee + providerFundingFee;
  double get amountReceived => recipientAmount;
  double get totalCost => totalCustomerCharge;

  factory TransferQuote.fromJson(Map<String, dynamic> json) {
    final corridor = json['corridor'] as Map<String, dynamic>? ?? const {};
    return TransferQuote(
      quoteId: json['quoteId'] as String,
      sendAmount: (json['sendAmount'] as num).toDouble(),
      exchangeRate: (json['exchangeRate'] as num).toDouble(),
      ticashFee: (json['ticashFee'] as num).toDouble(),
      providerFundingFee: (json['providerFundingFee'] as num).toDouble(),
      recipientAmount: (json['recipientAmount'] as num).toDouble(),
      totalCustomerCharge: (json['totalCustomerCharge'] as num).toDouble(),
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      testMode: json['testMode'] as bool,
      sourceCurrency: corridor['sourceCurrency'] as String? ?? 'USD',
      targetCurrency: corridor['targetCurrency'] as String? ?? 'HTG',
    );
  }
}

class SendCorridor {
  const SendCorridor({
    required this.sendCountry,
    required this.sourceCurrency,
    required this.receiveCountry,
    required this.targetCurrency,
    required this.quoteEnabled,
    required this.fundingEnabled,
  });

  final String sendCountry;
  final String sourceCurrency;
  final String receiveCountry;
  final String targetCurrency;
  final bool quoteEnabled;
  final bool fundingEnabled;

  factory SendCorridor.fromJson(Map<String, dynamic> json) => SendCorridor(
    sendCountry: json['sendCountry'] as String,
    sourceCurrency: json['sourceCurrency'] as String,
    receiveCountry: json['receiveCountry'] as String,
    targetCurrency: json['targetCurrency'] as String,
    quoteEnabled:
        (json['quoteEnabled'] as bool?) ??
        (json['enabledForSandbox'] as bool? ?? false),
    fundingEnabled: json['fundingEnabled'] as bool? ?? false,
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
    required String amountCurrency,
    required String sendCountry,
    required String sourceCurrency,
  }) async {
    final response = await _dio.post(
      '${ApiConfig.transfers}/quote',
      data: {
        'recipient': recipient,
        'amount': amount,
        'amountCurrency': amountCurrency,
        'sendCountry': sendCountry,
        'sourceCurrency': sourceCurrency,
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
    required String amountCurrency,
    required String sendCountry,
    required String sourceCurrency,
  }) async {
    final response = await _dio.post(
      ApiConfig.transfers,
      data: {
        'recipient': recipient,
        'amount': amount,
        'amountCurrency': amountCurrency,
        'quoteId': quoteId,
        'sendCountry': sendCountry,
        'sourceCurrency': sourceCurrency,
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
    final sources =
        ((response.data as Map<String, dynamic>)['fundingSources']
                as List<dynamic>)
            .map((item) => FundingSource.fromJson(item as Map<String, dynamic>))
            .toList();
    sources.sort(
      (a, b) => a.isDefault == b.isDefault ? 0 : (a.isDefault ? -1 : 1),
    );
    return sources;
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

  Future<List<SendCorridor>> corridors() async {
    final response = await _dio.get('/corridors');
    final data = response.data as Map<String, dynamic>;
    return (data['corridors'] as List<dynamic>)
        .map((item) => SendCorridor.fromJson(item as Map<String, dynamic>))
        .where(
          (item) =>
              item.receiveCountry == 'HT' &&
              item.targetCurrency == 'HTG' &&
              item.quoteEnabled,
        )
        .toList();
  }
}

class FundingSource {
  const FundingSource({
    required this.id,
    required this.name,
    required this.lastFour,
    required this.status,
    required this.accountType,
    required this.isDefault,
  });
  final String id;
  final String name;
  final String lastFour;
  final String status;
  final String accountType;
  final bool isDefault;
  factory FundingSource.fromJson(Map<String, dynamic> json) => FundingSource(
    id: json['id'] as String,
    name: json['name'] as String,
    lastFour: json['lastFour'] as String,
    status: json['status'] as String,
    accountType: json['bankAccountType'] as String? ?? 'checking',
    isDefault: json['isDefault'] as bool? ?? false,
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
