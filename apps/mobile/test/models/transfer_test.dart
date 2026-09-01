import 'package:flutter_test/flutter_test.dart';

import 'package:ticash/models/transfer.dart';

void main() {
  group('Transfer', () {
    test('computes total cost and amount received', () {
      final transfer = Transfer(
        id: 't1',
        recipientId: 'r1',
        amount: 100,
        sourceCurrency: 'USD',
        targetCurrency: 'HTG',
        fee: 5,
        exchangeRate: 130,
        status: TransferStatus.pending,
        createdAt: DateTime(2024, 1, 1),
      );

      expect(transfer.totalCost, 105);
      expect(transfer.amountReceived, 13000);
    });

    test('round-trips through JSON', () {
      final json = {
        'id': 't1',
        'recipientId': 'r1',
        'amount': 100.0,
        'sourceCurrency': 'USD',
        'targetCurrency': 'HTG',
        'fee': 5.0,
        'exchangeRate': 130.0,
        'status': 'completed',
        'createdAt': '2024-01-01T00:00:00.000',
      };

      final transfer = Transfer.fromJson(json);

      expect(transfer.status, TransferStatus.completed);
      expect(transfer.toJson()['status'], 'completed');
    });
  });
}
