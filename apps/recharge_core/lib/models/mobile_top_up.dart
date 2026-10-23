enum MobileTopUpKind { airtime, data, bundle }

MobileTopUpKind _kind(dynamic value) => switch (value) {
  'AIRTIME' => MobileTopUpKind.airtime,
  'DATA' => MobileTopUpKind.data,
  'BUNDLE' => MobileTopUpKind.bundle,
  _ => throw const FormatException('Unsupported recharge product kind'),
};

enum MobileTopUpStatus { pending, processing, delivered, failed, refunded }

String? _explicitCountryCode(Map<String, dynamic> json) {
  final countryCode = ((json['countryCode'] ?? json['code']) as String?)
      ?.trim();
  if (countryCode != null && countryCode.isNotEmpty) {
    return countryCode.toUpperCase();
  }
  return null;
}

String? _countryCodeFromProductId(
  Map<String, dynamic> json,
  String productKey,
) {
  final productId = (json[productKey] as String?)?.trim();
  if (productId == null || productId.isEmpty) return null;
  final parts = productId.split(':');
  if (parts.length < 2) return null;
  final code = parts[1].trim().toUpperCase();
  return RegExp(r'^[A-Z]{2}$').hasMatch(code) ? code : null;
}

String _countryCodeFromJson(
  Map<String, dynamic> json, {
  String? phoneKey,
  String? productKey,
  String? fallback,
  bool allowLegacyHaitiPhoneFallback = false,
}) {
  final explicit = _explicitCountryCode(json);
  if (explicit != null) return explicit;
  if (productKey != null) {
    final fromProductId = _countryCodeFromProductId(json, productKey);
    if (fromProductId != null) return fromProductId;
  }
  final phone = phoneKey == null ? null : (json[phoneKey] as String?)?.trim();
  if (allowLegacyHaitiPhoneFallback && phone != null) {
    final compact = phone.replaceAll(RegExp(r'[\s().-]'), '');
    final digitsOnly = compact.replaceFirst(RegExp(r'^\+'), '');
    if (RegExp(r'^509\d{8}$').hasMatch(digitsOnly)) {
      return 'HT';
    }
  }
  if (fallback != null) return fallback;
  throw StateError('Mobile Recharge response is missing a countryCode');
}

String? _nullableCountryCodeFromJson(
  Map<String, dynamic> json, {
  String? phoneKey,
  String? productKey,
  String? fallback,
  bool allowLegacyHaitiPhoneFallback = false,
}) {
  try {
    return _countryCodeFromJson(
      json,
      phoneKey: phoneKey,
      productKey: productKey,
      fallback: fallback,
      allowLegacyHaitiPhoneFallback: allowLegacyHaitiPhoneFallback,
    );
  } on StateError {
    return null;
  }
}

class MobileTopUpAvailability {
  const MobileTopUpAvailability({
    required this.enabled,
    required this.environment,
    required this.testMode,
    required this.productionEnabled,
    required this.approvedForLiveUse,
    required this.liveRechargeEnabled,
    this.recurringRechargeEnabled = false,
    this.providers = const [],
    this.paymentMode,
  });
  final bool enabled;
  final String environment;
  final bool testMode;
  final bool productionEnabled;
  final bool approvedForLiveUse;
  final bool liveRechargeEnabled;
  final bool recurringRechargeEnabled;
  final List<String> providers;
  final String? paymentMode;

  bool get isGenuinelyLive =>
      environment.toUpperCase() == 'PRODUCTION' &&
      !testMode &&
      productionEnabled &&
      approvedForLiveUse &&
      liveRechargeEnabled;

  bool get requiresSafetyWarning => !isGenuinelyLive;

  factory MobileTopUpAvailability.fromJson(Map<String, dynamic> json) =>
      MobileTopUpAvailability(
        enabled: json['enabled'] as bool? ?? false,
        paymentMode: json['paymentMode'] as String?,
        environment: json['environment'] as String? ?? 'SANDBOX',
        testMode: json['testMode'] as bool? ?? true,
        productionEnabled: json['productionEnabled'] as bool? ?? false,
        approvedForLiveUse: json['approvedForLiveUse'] as bool? ?? false,
        liveRechargeEnabled: json['liveRechargeEnabled'] as bool? ?? false,
        recurringRechargeEnabled:
            json['recurringRechargeEnabled'] as bool? ?? false,
        providers: (json['providers'] as List<dynamic>? ?? const [])
            .whereType<String>()
            .toList(),
      );
}

class MobileTopUpCountry {
  const MobileTopUpCountry({required this.code, required this.name});
  final String code;
  final String name;
  factory MobileTopUpCountry.fromJson(Map<String, dynamic> json) {
    final code = _countryCodeFromJson(json);
    return MobileTopUpCountry(
      code: code,
      name: (json['name'] ?? json['countryName'] ?? code) as String,
    );
  }
}

class MobileTopUpOperator {
  static String? parseLogoUrl(Object? value) {
    if (value is! String ||
        !RegExp(r'^https://[^/\\?#]', caseSensitive: false).hasMatch(value) ||
        RegExp(r'[\s\x00-\x1f\x7f\\]').hasMatch(value) ||
        RegExp(r'%(?![0-9a-f]{2})', caseSensitive: false).hasMatch(value)) {
      return null;
    }
    final uri = Uri.tryParse(value);
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      return null;
    }
    return value;
  }

  const MobileTopUpOperator({
    required this.id,
    required this.name,
    required this.countryCode,
    required this.bundle,
    this.data = false,
    this.combo = false,
    this.provider,
    this.logoUrl,
  });
  final int id;
  final String name;
  final String countryCode;
  final bool bundle;
  final bool data;
  final bool combo;
  bool get internetService => bundle || data || combo;
  final String? provider;
  final String? logoUrl;
  factory MobileTopUpOperator.fromJson(Map<String, dynamic> json) =>
      MobileTopUpOperator(
        id: (json['id'] as num).toInt(),
        name: json['name'] as String,
        countryCode: _countryCodeFromJson(json),
        bundle: json['bundle'] as bool? ?? false,
        data: json['data'] as bool? ?? false,
        combo: json['combo'] as bool? ?? false,
        provider: json['provider'] as String?,
        logoUrl: parseLogoUrl(json['logoUrl']),
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
    this.description,
    this.benefits = const [],
    this.validityLabel,
    this.catalogVersion,
    this.amountIncrement,
    this.amountPrecision,
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
  final String? description;
  final List<String> benefits;
  final String? validityLabel;
  final String? catalogVersion;
  final double? amountIncrement;
  final int? amountPrecision;

  static List<String> _benefits(dynamic value) {
    if (value is! List) return const [];
    return value
        .whereType<Map>()
        .map((item) {
          final type = item['type']?.toString() ?? '';
          final amount = item['amount'];
          final unit = item['unit']?.toString().replaceAll('_', ' ') ?? '';
          if (amount == -1) return 'Unlimited $type';
          return '$amount $unit ${type.toLowerCase()}'.trim();
        })
        .where((item) => item.isNotEmpty)
        .toList();
  }

  static String? _validity(dynamic value) {
    if (value is! Map) return null;
    final quantity = value['quantity'];
    final unit = value['unit']?.toString().toLowerCase();
    if (quantity == null || unit == null) return null;
    if (quantity == -1) return 'No fixed expiry';
    final suffix = quantity == 1 ? unit : '${unit}s';
    return '$quantity $suffix';
  }

  factory MobileTopUpProduct.fromJson(Map<String, dynamic> json) =>
      MobileTopUpProduct(
        id: json['id'] as String,
        operatorId: (json['operatorId'] as num).toInt(),
        kind: _kind(json['classification'] ?? json['kind']),
        name: json['name'] as String,
        price: (json['price'] as num).toDouble(),
        priceCurrency: json['priceCurrency'] as String,
        deliveredValue: (json['deliveredValue'] as num?)?.toDouble(),
        deliveredCurrency: json['deliveredCurrency'] as String,
        amountType: json['amountType'] as String,
        minimumAmount: (json['minimumAmount'] as num?)?.toDouble(),
        maximumAmount: (json['maximumAmount'] as num?)?.toDouble(),
        description: json['description'] as String?,
        benefits: _benefits(json['benefits']),
        validityLabel: _validity(json['validity']),
        catalogVersion: json['catalogVersion'] as String?,
        amountIncrement: (json['amountIncrement'] as num?)?.toDouble(),
        amountPrecision: (json['amountPrecision'] as num?)?.toInt(),
      );
}

class MobileTopUpRecipient {
  const MobileTopUpRecipient({
    required this.id,
    required this.nickname,
    required this.phone,
    required this.countryCode,
    this.operatorId,
    this.operatorName,
    this.lastProductName,
  });
  final String id;
  final String nickname;
  final String phone;
  final String countryCode;
  final int? operatorId;
  final String? operatorName;
  final String? lastProductName;
  factory MobileTopUpRecipient.fromJson(Map<String, dynamic> json) =>
      MobileTopUpRecipient(
        id: json['id'] as String,
        nickname: json['nickname'] as String,
        phone: json['phone'] as String,
        countryCode: _countryCodeFromJson(
          json,
          phoneKey: 'phone',
          allowLegacyHaitiPhoneFallback: true,
        ),
        operatorId: (json['operatorId'] as num?)?.toInt(),
        operatorName: json['operatorName'] as String?,
        lastProductName: json['lastProductName'] as String?,
      );
}

class MobileTopUpQuote {
  const MobileTopUpQuote({
    required this.id,
    required this.phone,
    required this.countryCode,
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
    this.receiverQuote,
    this.promotion,
  });
  final String id;
  final String phone;
  final String countryCode;
  final int operatorId;
  final String operatorName;
  final String productId;
  final String productName;
  final MobileTopUpKind kind;
  final double providerAmount;
  final String providerCurrency;
  final double? deliveredValue;
  final Map<String, dynamic>? receiverQuote;
  final Map<String, dynamic>? promotion;
  final String deliveredCurrency;
  final double feeUsd;
  final double totalChargeUsd;
  final DateTime expiresAt;
  factory MobileTopUpQuote.fromJson(Map<String, dynamic> json) =>
      MobileTopUpQuote(
        id: json['id'] as String,
        phone: json['recipientPhone'] as String,
        countryCode: _countryCodeFromJson(
          json,
          phoneKey: 'recipientPhone',
          allowLegacyHaitiPhoneFallback: true,
          productKey: 'productId',
        ),
        operatorId: (json['operatorId'] as num).toInt(),
        operatorName: json['operatorName'] as String,
        productId: json['productId'] as String,
        productName: json['productName'] as String,
        kind: _kind(json['kind']),
        providerAmount: (json['providerAmount'] as num).toDouble(),
        providerCurrency: json['providerCurrency'] as String,
        receiverQuote: json['receiverQuote'] == null
            ? null
            : Map<String, dynamic>.from(json['receiverQuote'] as Map),
        promotion: json['promotion'] is Map
            ? Map<String, dynamic>.from(json['promotion'] as Map)
            : null,
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
    required this.countryCode,
    required this.operatorName,
    required this.productName,
    required this.kind,
    required this.providerAmount,
    required this.providerCurrency,
    required this.deliveredCurrency,
    required this.feeUsd,
    required this.totalChargeUsd,
    required this.status,
    required this.paymentStatus,
    required this.testMode,
    required this.createdAt,
    this.deliveredValue,
    this.providerTransactionId,
    this.receiverQuote,
    this.receiverDiscrepancy = false,
    this.failureCode,
  });
  final String id;
  final String phone;
  final String? countryCode;
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
  final String paymentStatus;
  final bool testMode;
  final DateTime createdAt;
  final String? providerTransactionId;
  final Map<String, dynamic>? receiverQuote;
  final bool receiverDiscrepancy;
  final String? failureCode;
  factory MobileTopUpTransaction.fromJson(Map<String, dynamic> json) =>
      MobileTopUpTransaction(
        id: json['id'] as String,
        phone: json['recipientPhone'] as String,
        countryCode: _nullableCountryCodeFromJson(
          json,
          phoneKey: 'recipientPhone',
          allowLegacyHaitiPhoneFallback: true,
          productKey: 'productId',
        ),
        operatorName: json['operatorName'] as String,
        productName: json['productName'] as String,
        kind: _kind(json['kind']),
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
        paymentStatus: (json['paymentStatus'] as String? ?? 'PENDING')
            .toUpperCase(),
        testMode: json['testMode'] as bool? ?? true,
        createdAt: DateTime.parse(json['createdAt'] as String),
        receiverQuote: json['receiverQuote'] == null
            ? null
            : Map<String, dynamic>.from(json['receiverQuote'] as Map),
        receiverDiscrepancy: json['receiverDiscrepancy'] == true,
        providerTransactionId: json['providerTransactionId'] as String?,
        failureCode: json['failureCode'] as String?,
      );
}
