enum BankVerificationStatus { pending, verified, failed, removed }

class BankAccount {
  const BankAccount({
    required this.id,
    required this.name,
    required this.lastFour,
    required this.accountType,
    required this.status,
    required this.isDefault,
    required this.verificationAttempts,
    required this.createdAt,
    required this.updatedAt,
    this.bankName,
    this.microDepositsInitiatedAt,
  });

  final String id;
  final String name;
  final String? bankName;
  final String lastFour;
  final String accountType;
  final BankVerificationStatus status;
  final bool isDefault;
  final int verificationAttempts;
  final DateTime? microDepositsInitiatedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get canVerify =>
      status == BankVerificationStatus.pending && verificationAttempts < 3;

  factory BankAccount.fromJson(Map<String, dynamic> json) {
    final rawStatus = (json['status'] as String? ?? 'PENDING').toLowerCase();
    return BankAccount(
      id: json['id'] as String,
      name: json['name'] as String? ?? 'Bank account',
      bankName: json['bankName'] as String?,
      lastFour: json['lastFour'] as String? ?? '',
      accountType: json['bankAccountType'] as String? ?? 'checking',
      status: BankVerificationStatus.values.firstWhere(
        (item) => item.name == rawStatus,
        orElse: () => BankVerificationStatus.pending,
      ),
      isDefault: json['isDefault'] as bool? ?? false,
      verificationAttempts: json['verificationAttempts'] as int? ?? 0,
      microDepositsInitiatedAt: json['microDepositsInitiatedAt'] == null
          ? null
          : DateTime.parse(json['microDepositsInitiatedAt'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }
}
