import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/models/user.dart';

void main() {
  test('parses API KYC states and administrator role', () {
    final user = User.fromJson({
      'id': 'user-1',
      'email': 'admin@ticash.local',
      'firstName': 'TiCash',
      'lastName': 'Admin',
      'phoneNumber': '+12025550144',
      'countryCode': 'CA',
      'addressLine1': '123 King Street',
      'addressLine2': 'Unit 4',
      'city': 'Toronto',
      'region': 'Ontario',
      'postalCode': 'M5V 2T6',
      'kycStatus': 'IN_REVIEW',
      'role': 'ADMIN',
      'createdAt': '2026-09-01T00:00:00.000Z',
    });

    expect(user.kycStatus, KycStatus.inReview);
    expect(user.role, 'ADMIN');
    expect(user.fullName, 'TiCash Admin');
    expect(user.countryCode, 'CA');
    expect(user.addressLine1, '123 King Street');
    expect(user.city, 'Toronto');
    expect(user.region, 'Ontario');
    expect(user.postalCode, 'M5V 2T6');
  });
}
