import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/models/kyc.dart';
import 'package:ticash/models/user.dart';

void main() {
  test('parses the backend Didit session without an API key', () {
    final session = KycSession.fromJson({
      'sessionId': 'f5faccee-7e82-41ff-bcbc-e8016f520cf8',
      'sessionToken': 'ephemeral-session-token',
      'status': 'PENDING',
    });
    expect(session.status, KycStatus.pending);
    expect(session.sessionToken, 'ephemeral-session-token');
  });

  test('parses every backend-authoritative KYC state', () {
    expect(KycStatus.fromApi('NOT_STARTED'), KycStatus.notStarted);
    expect(KycStatus.fromApi('PENDING'), KycStatus.pending);
    expect(KycStatus.fromApi('IN_REVIEW'), KycStatus.inReview);
    expect(KycStatus.fromApi('APPROVED'), KycStatus.approved);
    expect(KycStatus.fromApi('DECLINED'), KycStatus.declined);
    expect(KycStatus.fromApi('EXPIRED'), KycStatus.expired);
  });
}
