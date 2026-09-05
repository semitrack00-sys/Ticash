/// Status of a money transfer.
enum TransferStatus {
  pending,
  processing,
  completed,
  failed,
  cancelled,
  reversed,
}

enum TransferStage {
  awaitingFunding,
  fundingProcessing,
  complianceReview,
  payoutProcessing,
  delivered,
  failed,
  cancelled,
  reversed,
}

/// A money transfer between a TiCash user and a recipient.
class Transfer {
  final String id;
  final String referenceNumber;
  final String recipientId;
  final String recipientName;
  final double amount;
  final String sourceCurrency;
  final String targetCurrency;
  final double fee;
  final double exchangeRate;
  final double amountReceived;
  final TransferStatus status;
  final TransferStage stage;
  final bool testMode;
  final double ticashFee;
  final double providerFundingFee;
  final double totalCharged;
  final DateTime createdAt;
  final String? recipientPhone;
  final String? payoutMethod;
  final String? providerTransactionId;
  final String? fundingTransactionId;
  final String? failureCode;
  final DateTime? completedAt;
  final String? configurationVersionId;

  const Transfer({
    required this.id,
    required this.referenceNumber,
    required this.recipientId,
    required this.recipientName,
    required this.amount,
    required this.sourceCurrency,
    required this.targetCurrency,
    required this.fee,
    required this.exchangeRate,
    required this.amountReceived,
    required this.status,
    required this.stage,
    required this.testMode,
    required this.ticashFee,
    required this.providerFundingFee,
    required this.totalCharged,
    required this.createdAt,
    this.recipientPhone,
    this.payoutMethod,
    this.providerTransactionId,
    this.fundingTransactionId,
    this.failureCode,
    this.completedAt,
    this.configurationVersionId,
  });

  double get totalCost => amount + fee;

  factory Transfer.fromJson(Map<String, dynamic> json) {
    return Transfer(
      id: json['id'] as String,
      referenceNumber:
          (json['referenceNumber'] as String?) ?? (json['id'] as String),
      recipientId: json['recipientId'] as String,
      recipientName: (json['recipientName'] as String?) ?? '',
      amount: (json['amount'] as num).toDouble(),
      sourceCurrency: json['sourceCurrency'] as String,
      targetCurrency: json['targetCurrency'] as String,
      fee: (json['fee'] as num).toDouble(),
      exchangeRate: (json['exchangeRate'] as num).toDouble(),
      amountReceived: (json['amountReceived'] as num).toDouble(),
      status: TransferStatus.values.firstWhere(
        (status) => status.name == (json['status'] as String?)?.toLowerCase(),
        orElse: () => TransferStatus.pending,
      ),
      stage: TransferStage.values.firstWhere(
        (stage) =>
            stage.name.toUpperCase() ==
            ((json['stage'] as String?) ?? 'AWAITING_FUNDING')
                .replaceAll('_', '')
                .toUpperCase(),
        orElse: () => TransferStage.awaitingFunding,
      ),
      testMode: (json['testMode'] as bool?) ?? true,
      ticashFee: ((json['ticashFee'] ?? json['fee']) as num).toDouble(),
      providerFundingFee: ((json['providerFundingFee'] as num?) ?? 0)
          .toDouble(),
      totalCharged:
          ((json['totalCharged'] as num?) ??
                  ((json['amount'] as num).toDouble() +
                      (json['fee'] as num).toDouble()))
              .toDouble(),
      createdAt: DateTime.parse(json['createdAt'] as String),
      recipientPhone: json['recipientPhone'] as String?,
      payoutMethod: json['payoutMethod'] as String?,
      providerTransactionId: json['providerTransactionId'] as String?,
      fundingTransactionId: json['fundingTransactionId'] as String?,
      failureCode: json['failureCode'] as String?,
      completedAt: json['completedAt'] == null
          ? null
          : DateTime.parse(json['completedAt'] as String),
      configurationVersionId: json['configurationVersionId'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'referenceNumber': referenceNumber,
      'recipientId': recipientId,
      'recipientName': recipientName,
      'amount': amount,
      'sourceCurrency': sourceCurrency,
      'targetCurrency': targetCurrency,
      'fee': fee,
      'exchangeRate': exchangeRate,
      'amountReceived': amountReceived,
      'status': status.name,
      'stage': stage.name,
      'testMode': testMode,
      'ticashFee': ticashFee,
      'providerFundingFee': providerFundingFee,
      'totalCharged': totalCharged,
      'createdAt': createdAt.toIso8601String(),
      'recipientPhone': recipientPhone,
      'payoutMethod': payoutMethod,
      'providerTransactionId': providerTransactionId,
      'fundingTransactionId': fundingTransactionId,
      'failureCode': failureCode,
      'completedAt': completedAt?.toIso8601String(),
      'configurationVersionId': configurationVersionId,
    };
  }
}
