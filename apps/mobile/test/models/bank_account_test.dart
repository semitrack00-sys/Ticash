import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/models/bank_account.dart';

void main() {
  test('parses only masked bank display metadata', () {
    final account = BankAccount.fromJson({
      'id': 'bank-1',
      'name': 'Primary checking',
      'bankName': 'SANDBOX TEST BANK',
      'lastFour': '4821',
      'bankAccountType': 'checking',
      'status': 'VERIFIED',
      'isDefault': true,
      'verificationAttempts': 1,
      'microDepositsInitiatedAt': '2026-09-05T12:00:00.000Z',
      'createdAt': '2026-09-05T11:00:00.000Z',
      'updatedAt': '2026-09-05T12:00:00.000Z',
    });

    expect(account.lastFour, '4821');
    expect(account.status, BankVerificationStatus.verified);
    expect(account.isDefault, isTrue);
    expect(account.canVerify, isFalse);
  });

  test('pending bank can verify only before the provider attempt limit', () {
    BankAccount pending(int attempts) => BankAccount.fromJson({
      'id': 'bank-$attempts',
      'name': 'Savings',
      'lastFour': '1234',
      'bankAccountType': 'savings',
      'status': 'PENDING',
      'isDefault': false,
      'verificationAttempts': attempts,
      'createdAt': '2026-09-05T11:00:00.000Z',
      'updatedAt': '2026-09-05T12:00:00.000Z',
    });

    expect(pending(2).canVerify, isTrue);
    expect(pending(3).canVerify, isFalse);
  });
}
