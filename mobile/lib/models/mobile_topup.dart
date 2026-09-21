enum MobileTopUpProductKind { airtime, data }
enum MobileTopUpAmountType { fixed, range }

double? _asDouble(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}

String _countryCode(Map<String, dynamic> json) {
  final raw = (json['countryCode'] ?? json['code'] ?? 'HT').toString().trim();
  return raw.isEmpty ? 'HT' : raw.toUpperCase();
}

class MobileTopUpCountry {
  const MobileTopUpCountry({
    required this.code,
    required this.name,
  });

  factory MobileTopUpCountry.fromJson(Map<String, dynamic> json) {
    return MobileTopUpCountry(
      code: _countryCode(json),
      name: (json['name'] ?? json['countryName'] ?? json['code'] ?? 'Unknown')
          .toString(),
    );
  }

  final String code;
  final String name;
}

class MobileTopUpOperator {
  const MobileTopUpOperator({
    required this.id,
    required this.name,
    required this.countryCode,
    required this.destinationCurrencyCode,
  });

  factory MobileTopUpOperator.fromJson(Map<String, dynamic> json) {
    return MobileTopUpOperator(
      id: (json['id'] ?? json['operatorId']) as int,
      name: (json['name'] ?? 'Unknown operator').toString(),
      countryCode: _countryCode(json),
      destinationCurrencyCode:
          (json['destinationCurrencyCode'] ?? 'USD').toString().toUpperCase(),
    );
  }

  final int id;
  final String name;
  final String countryCode;
  final String destinationCurrencyCode;
}

class MobileTopUpProduct {
  const MobileTopUpProduct({
    required this.id,
    required this.countryCode,
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

  factory MobileTopUpProduct.fromJson(Map<String, dynamic> json) {
    return MobileTopUpProduct(
      id: json['id'].toString(),
      countryCode: _countryCode(json),
      operatorId: json['operatorId'] as int,
      kind: (json['kind'] ?? 'AIRTIME').toString().toUpperCase() == 'DATA'
          ? MobileTopUpProductKind.data
          : MobileTopUpProductKind.airtime,
      name: (json['name'] ?? 'Recharge').toString(),
      price: _asDouble(json['price']) ?? 0,
      priceCurrency: (json['priceCurrency'] ?? 'USD').toString().toUpperCase(),
      deliveredCurrency:
          (json['deliveredCurrency'] ?? 'USD').toString().toUpperCase(),
      amountType:
          (json['amountType'] ?? 'FIXED').toString().toUpperCase() == 'RANGE'
              ? MobileTopUpAmountType.range
              : MobileTopUpAmountType.fixed,
      deliveredValue: _asDouble(json['deliveredValue']),
      minimumAmount: _asDouble(json['minimumAmount']),
      maximumAmount: _asDouble(json['maximumAmount']),
    );
  }

  final String id;
  final String countryCode;
  final int operatorId;
  final MobileTopUpProductKind kind;
  final String name;
  final double price;
  final String priceCurrency;
  final String deliveredCurrency;
  final MobileTopUpAmountType amountType;
  final double? deliveredValue;
  final double? minimumAmount;
  final double? maximumAmount;
}

class MobileTopUpRecipient {
  const MobileTopUpRecipient({
    required this.id,
    required this.nickname,
    required this.phone,
    required this.countryCode,
    this.operatorId,
    this.operatorName,
    this.lastProductId,
    this.lastProductName,
  });

  factory MobileTopUpRecipient.fromJson(Map<String, dynamic> json) {
    return MobileTopUpRecipient(
      id: json['id'].toString(),
      nickname: (json['nickname'] ?? 'Saved recipient').toString(),
      phone: (json['phone'] ?? '').toString(),
      countryCode: _countryCode(json),
      operatorId: json['operatorId'] as int?,
      operatorName: json['operatorName']?.toString(),
      lastProductId: json['lastProductId']?.toString(),
      lastProductName: json['lastProductName']?.toString(),
    );
  }

  final String id;
  final String nickname;
  final String phone;
  final String countryCode;
  final int? operatorId;
  final String? operatorName;
  final String? lastProductId;
  final String? lastProductName;
}

class MobileTopUpQuote {
  const MobileTopUpQuote({
    required this.id,
    required this.countryCode,
    required this.recipientPhone,
    required this.operatorId,
    required this.operatorName,
    required this.productId,
    required this.productName,
    required this.providerAmount,
    required this.providerCurrency,
    required this.deliveredCurrency,
    required this.feeUsd,
    required this.totalChargeUsd,
    required this.expiresAt,
    this.deliveredValue,
  });

  factory MobileTopUpQuote.fromJson(Map<String, dynamic> json) {
    return MobileTopUpQuote(
      id: json['id'].toString(),
      countryCode: _countryCode(json),
      recipientPhone: (json['recipientPhone'] ?? '').toString(),
      operatorId: json['operatorId'] as int,
      operatorName: (json['operatorName'] ?? '').toString(),
      productId: (json['productId'] ?? '').toString(),
      productName: (json['productName'] ?? '').toString(),
      providerAmount: _asDouble(json['providerAmount']) ?? 0,
      providerCurrency:
          (json['providerCurrency'] ?? 'USD').toString().toUpperCase(),
      deliveredCurrency:
          (json['deliveredCurrency'] ?? 'USD').toString().toUpperCase(),
      feeUsd: _asDouble(json['feeUsd']) ?? 0,
      totalChargeUsd: _asDouble(json['totalChargeUsd']) ?? 0,
      expiresAt: DateTime.parse(json['expiresAt'].toString()),
      deliveredValue: _asDouble(json['deliveredValue']),
    );
  }

  final String id;
  final String countryCode;
  final String recipientPhone;
  final int operatorId;
  final String operatorName;
  final String productId;
  final String productName;
  final double providerAmount;
  final String providerCurrency;
  final String deliveredCurrency;
  final double feeUsd;
  final double totalChargeUsd;
  final DateTime expiresAt;
  final double? deliveredValue;
}

class MobileTopUpTransaction {
  const MobileTopUpTransaction({
    required this.id,
    required this.countryCode,
    required this.recipientPhone,
    required this.operatorName,
    required this.productName,
    required this.status,
    required this.totalChargeUsd,
    required this.createdAt,
  });

  factory MobileTopUpTransaction.fromJson(Map<String, dynamic> json) {
    return MobileTopUpTransaction(
      id: json['id'].toString(),
      countryCode: _countryCode(json),
      recipientPhone: (json['recipientPhone'] ?? '').toString(),
      operatorName: (json['operatorName'] ?? '').toString(),
      productName: (json['productName'] ?? '').toString(),
      status: (json['status'] ?? 'PENDING').toString(),
      totalChargeUsd: _asDouble(json['totalChargeUsd']) ?? 0,
      createdAt: DateTime.parse(
        (json['createdAt'] ?? DateTime.now().toIso8601String()).toString(),
      ),
    );
  }

  final String id;
  final String countryCode;
  final String recipientPhone;
  final String operatorName;
  final String productName;
  final String status;
  final double totalChargeUsd;
  final DateTime createdAt;
}
