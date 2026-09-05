/// Represents an authenticated TiCash user.
class User {
  final String id;
  final String email;
  final String firstName;
  final String lastName;
  final String? phoneNumber;
  final KycStatus kycStatus;
  final DateTime createdAt;
  final String role;

  const User({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.kycStatus,
    required this.createdAt,
    this.role = 'CUSTOMER',
    this.phoneNumber,
  });

  String get fullName => '$firstName $lastName';

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      email: json['email'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      phoneNumber: json['phoneNumber'] as String?,
      kycStatus: KycStatus.fromApi(json['kycStatus'] as String?),
      createdAt: DateTime.parse(json['createdAt'] as String),
      role: json['role'] as String? ?? 'CUSTOMER',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'email': email,
      'firstName': firstName,
      'lastName': lastName,
      'phoneNumber': phoneNumber,
      'kycStatus': kycStatus.name,
      'createdAt': createdAt.toIso8601String(),
      'role': role,
    };
  }
}

/// KYC (Know Your Customer) verification status.
enum KycStatus {
  notStarted,
  pending,
  inReview,
  approved,
  declined,
  expired;

  static KycStatus fromApi(String? value) {
    final normalized = value?.replaceAll('_', '').toLowerCase();
    return KycStatus.values.firstWhere(
      (status) => status.name.toLowerCase() == normalized,
      orElse: () => KycStatus.notStarted,
    );
  }
}
