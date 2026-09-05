/// A saved money transfer recipient.
class Recipient {
  final String id;
  final String fullName;
  final String country;
  final String phoneNumber;
  final String? payoutMethod;
  final String address;
  final String city;
  final String department;

  const Recipient({
    required this.id,
    required this.fullName,
    required this.country,
    required this.phoneNumber,
    this.payoutMethod,
    this.address = '',
    this.city = '',
    this.department = '',
  });

  factory Recipient.fromJson(Map<String, dynamic> json) {
    return Recipient(
      id: json['id'] as String,
      fullName: json['fullName'] as String,
      country: json['country'] as String,
      phoneNumber: json['phoneNumber'] as String,
      payoutMethod: json['payoutMethod'] as String?,
      address: json['address'] as String? ?? '',
      city: json['city'] as String? ?? '',
      department: json['department'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'fullName': fullName,
      'country': country,
      'phoneNumber': phoneNumber,
      'payoutMethod': payoutMethod,
      'address': address,
      'city': city,
      'department': department,
    };
  }
}
