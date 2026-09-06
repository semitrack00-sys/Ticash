import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/models/recipient.dart';

void main() {
  test('parses structured recipient names and builds the display name', () {
    final recipient = Recipient.fromJson({
      'id': 'recipient-1',
      'firstName': 'Jean',
      'middleName': 'Michel',
      'lastName': 'Pierre',
      'country': 'HT',
      'phoneNumber': '+50937123456',
      'payoutMethod': 'MONCASH',
    });

    expect(recipient.fullName, 'Jean Michel Pierre');
    expect(recipient.toJson(), containsPair('middleName', 'Michel'));
  });

  test('keeps older combined-name API responses readable', () {
    final recipient = Recipient.fromJson({
      'id': 'recipient-2',
      'fullName': 'Marie Anne Joseph',
      'country': 'HT',
      'phoneNumber': '+50938123456',
    });

    expect(recipient.firstName, 'Marie');
    expect(recipient.middleName, 'Anne');
    expect(recipient.lastName, 'Joseph');
  });
}
