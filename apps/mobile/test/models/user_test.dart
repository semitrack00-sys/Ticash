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
      'kycStatus': 'IN_REVIEW',
      'role': 'ADMIN',
      'createdAt': '2026-09-01T00:00:00.000Z',
    });

    expect(user.kycStatus, KycStatus.inReview);
    expect(user.role, 'ADMIN');
    expect(user.fullName, 'TiCash Admin');
  });
}
