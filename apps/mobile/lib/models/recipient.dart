/// A saved money transfer recipient.
class Recipient {
  final String id;
  final String firstName;
  final String? middleName;
  final String lastName;
  final String country;
  final String phoneNumber;
  final String? payoutMethod;
  final String address;
  final String city;
  final String department;

  const Recipient({
    required this.id,
    required this.firstName,
    this.middleName,
    required this.lastName,
    required this.country,
    required this.phoneNumber,
    this.payoutMethod,
    this.address = '',
    this.city = '',
    this.department = '',
  });

  String get fullName => [
    firstName,
    if (middleName?.trim().isNotEmpty == true) middleName!.trim(),
    lastName,
  ].join(' ');

  factory Recipient.fromJson(Map<String, dynamic> json) {
    final legacyName = (json['fullName'] as String? ?? '').trim();
    final legacyParts = legacyName
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();
    return Recipient(
      id: json['id'] as String,
      firstName:
          json['firstName'] as String? ??
          (legacyParts.isEmpty ? '' : legacyParts.first),
      middleName:
          json['middleName'] as String? ??
          (legacyParts.length > 2
              ? legacyParts.sublist(1, legacyParts.length - 1).join(' ')
              : null),
      lastName:
          json['lastName'] as String? ??
          (legacyParts.length < 2 ? '' : legacyParts.last),
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
      'firstName': firstName,
      'middleName': middleName,
      'lastName': lastName,
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
