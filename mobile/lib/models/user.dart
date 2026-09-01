/// KYC verification status for a [TicashUser].
enum KycStatus { notStarted, pending, approved, rejected, reviewRequired }

/// Represents the signed-in TiCash user shown on the home screen.
class TicashUser {
  const TicashUser({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.availableBalance,
    required this.currency,
    required this.kycStatus,
  });

  final String id;
  final String firstName;
  final String lastName;
  final double availableBalance;
  final String currency;
  final KycStatus kycStatus;

  String get fullName => '$firstName $lastName';

  bool get isIdentityVerified => kycStatus == KycStatus.approved;

  TicashUser copyWith({double? availableBalance}) {
    return TicashUser(
      id: id,
      firstName: firstName,
      lastName: lastName,
      availableBalance: availableBalance ?? this.availableBalance,
      currency: currency,
      kycStatus: kycStatus,
    );
  }
}
