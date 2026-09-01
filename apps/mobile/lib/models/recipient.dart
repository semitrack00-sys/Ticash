/// A saved money transfer recipient.
class Recipient {
  final String id;
  final String fullName;
  final String country;
  final String phoneNumber;
  final String? payoutMethod;

  const Recipient({
    required this.id,
    required this.fullName,
    required this.country,
    required this.phoneNumber,
    this.payoutMethod,
  });

  factory Recipient.fromJson(Map<String, dynamic> json) {
    return Recipient(
      id: json['id'] as String,
      fullName: json['fullName'] as String,
      country: json['country'] as String,
      phoneNumber: json['phoneNumber'] as String,
      payoutMethod: json['payoutMethod'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'fullName': fullName,
      'country': country,
      'phoneNumber': phoneNumber,
      'payoutMethod': payoutMethod,
    };
  }
}
