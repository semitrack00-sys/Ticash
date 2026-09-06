enum MobileTopUpKind { airtime, data }

enum MobileTopUpStatus { pending, processing, delivered, failed, refunded }

class MobileTopUpAvailability {
  const MobileTopUpAvailability({
    required this.enabled,
    required this.environment,
  });
  final bool enabled;
  final String environment;
  factory MobileTopUpAvailability.fromJson(Map<String, dynamic> json) =>
      MobileTopUpAvailability(
        enabled: json['enabled'] as bool? ?? false,
        environment: json['environment'] as String? ?? 'SANDBOX',
      );
}

class MobileTopUpOperator {
  const MobileTopUpOperator({
    required this.id,
    required this.name,
    required this.bundle,
  });
  final int id;
  final String name;
  final bool bundle;
  factory MobileTopUpOperator.fromJson(Map<String, dynamic> json) =>
      MobileTopUpOperator(
        id: (json['id'] as num).toInt(),
        name: json['name'] as String,
        bundle: json['bundle'] as bool? ?? false,
      );
}

class MobileTopUpProduct {
  const MobileTopUpProduct({
    required this.id,
    required this.operatorId,
    required this.kind,
    required this.name,
    required this.price,
    required this.priceCurrency,
    required this.deliveredCurrency,
    required this.amountType,
    this.deliveredValue,
    this.minimumAmount,
    this.maximumAmount,
  });
  final String id;
  final int operatorId;
  final MobileTopUpKind kind;
  final String name;
  final double price;
  final String priceCurrency;
  final double? deliveredValue;
  final String deliveredCurrency;
  final String amountType;
  final double? minimumAmount;
  final double? maximumAmount;
  factory MobileTopUpProduct.fromJson(Map<String, dynamic> json) =>
      MobileTopUpProduct(
        id: json['id'] as String,
        operatorId: (json['operatorId'] as num).toInt(),
        kind: (json['kind'] as String?) == 'DATA'
            ? MobileTopUpKind.data
            : MobileTopUpKind.airtime,
        name: json['name'] as String,
        price: (json['price'] as num).toDouble(),
        priceCurrency: json['priceCurrency'] as String,
        deliveredValue: (json['deliveredValue'] as num?)?.toDouble(),
        deliveredCurrency: json['deliveredCurrency'] as String,
        amountType: json['amountType'] as String,
        minimumAmount: (json['minimumAmount'] as num?)?.toDouble(),
        maximumAmount: (json['maximumAmount'] as num?)?.toDouble(),
      );
}

class MobileTopUpRecipient {
  const MobileTopUpRecipient({
    required this.id,
    required this.nickname,
    required this.phone,
    this.operatorId,
    this.operatorName,
    this.lastProductName,
  });
  final String id;
  final String nickname;
  final String phone;
  final int? operatorId;
  final String? operatorName;
  final String? lastProductName;
  factory MobileTopUpRecipient.fromJson(Map<String, dynamic> json) =>
      MobileTopUpRecipient(
        id: json['id'] as String,
        nickname: json['nickname'] as String,
        phone: json['phone'] as String,
        operatorId: (json['operatorId'] as num?)?.toInt(),
        operatorName: json['operatorName'] as String?,
        lastProductName: json['lastProductName'] as String?,
      );
}

class MobileTopUpQuote {
  const MobileTopUpQuote({
    required this.id,
    required this.phone,
    required this.operatorId,
    required this.operatorName,
    required this.productId,
    required this.productName,
    required this.kind,
    required this.providerAmount,
    required this.providerCurrency,
    required this.deliveredCurrency,
    required this.feeUsd,
    required this.totalChargeUsd,
    required this.expiresAt,
    this.deliveredValue,
  });
  final String id;
  final String phone;
  final int operatorId;
  final String operatorName;
  final String productId;
  final String productName;
  final MobileTopUpKind kind;
  final double providerAmount;
  final String providerCurrency;
  final double? deliveredValue;
  final String deliveredCurrency;
  final double feeUsd;
  final double totalChargeUsd;
  final DateTime expiresAt;
  factory MobileTopUpQuote.fromJson(Map<String, dynamic> json) =>
      MobileTopUpQuote(
        id: json['id'] as String,
        phone: json['recipientPhone'] as String,
        operatorId: (json['operatorId'] as num).toInt(),
        operatorName: json['operatorName'] as String,
        productId: json['productId'] as String,
        productName: json['productName'] as String,
        kind: json['kind'] == 'DATA'
            ? MobileTopUpKind.data
            : MobileTopUpKind.airtime,
        providerAmount: (json['providerAmount'] as num).toDouble(),
        providerCurrency: json['providerCurrency'] as String,
        deliveredValue: (json['deliveredValue'] as num?)?.toDouble(),
        deliveredCurrency: json['deliveredCurrency'] as String,
        feeUsd: (json['feeUsd'] as num).toDouble(),
        totalChargeUsd: (json['totalChargeUsd'] as num).toDouble(),
        expiresAt: DateTime.parse(json['expiresAt'] as String),
      );
}

class MobileTopUpTransaction {
  const MobileTopUpTransaction({
    required this.id,
    required this.phone,
    required this.operatorName,
    required this.productName,
    required this.kind,
    required this.providerAmount,
    required this.providerCurrency,
    required this.deliveredCurrency,
    required this.feeUsd,
    required this.totalChargeUsd,
    required this.status,
    required this.testMode,
    required this.createdAt,
    this.deliveredValue,
    this.providerTransactionId,
    this.failureCode,
  });
  final String id;
  final String phone;
  final String operatorName;
  final String productName;
  final MobileTopUpKind kind;
  final double providerAmount;
  final String providerCurrency;
  final double? deliveredValue;
  final String deliveredCurrency;
  final double feeUsd;
  final double totalChargeUsd;
  final MobileTopUpStatus status;
  final bool testMode;
  final DateTime createdAt;
  final String? providerTransactionId;
  final String? failureCode;
  factory MobileTopUpTransaction.fromJson(Map<String, dynamic> json) =>
      MobileTopUpTransaction(
        id: json['id'] as String,
        phone: json['recipientPhone'] as String,
        operatorName: json['operatorName'] as String,
        productName: json['productName'] as String,
        kind: json['kind'] == 'DATA'
            ? MobileTopUpKind.data
            : MobileTopUpKind.airtime,
        providerAmount: (json['providerAmount'] as num).toDouble(),
        providerCurrency: json['providerCurrency'] as String,
        deliveredValue: (json['deliveredValue'] as num?)?.toDouble(),
        deliveredCurrency: json['deliveredCurrency'] as String,
        feeUsd: (json['feeUsd'] as num).toDouble(),
        totalChargeUsd: (json['totalChargeUsd'] as num).toDouble(),
        status: MobileTopUpStatus.values.firstWhere(
          (item) => item.name == (json['status'] as String).toLowerCase(),
          orElse: () => MobileTopUpStatus.pending,
        ),
        testMode: json['testMode'] as bool? ?? true,
        createdAt: DateTime.parse(json['createdAt'] as String),
        providerTransactionId: json['providerTransactionId'] as String?,
        failureCode: json['failureCode'] as String?,
      );
}
