import 'package:flutter_test/flutter_test.dart';

import 'package:ticash/models/transfer.dart';

void main() {
  group('Transfer', () {
    test('uses the authoritative server recipient amount', () {
      final transfer = Transfer(
        id: 't1',
        referenceNumber: 'TC-1',
        recipientId: 'r1',
        recipientName: 'Recipient',
        amount: 100,
        sourceCurrency: 'USD',
        targetCurrency: 'HTG',
        fee: 5,
        exchangeRate: 130,
        amountReceived: 12999.99,
        status: TransferStatus.pending,
        stage: TransferStage.awaitingFunding,
        testMode: true,
        ticashFee: 5,
        providerFundingFee: 0,
        totalCharged: 105,
        createdAt: DateTime(2024, 1, 1),
      );

      expect(transfer.totalCost, 105);
      expect(transfer.amountReceived, 12999.99);
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
        'amountReceived': 13000.0,
        'status': 'completed',
        'createdAt': '2024-01-01T00:00:00.000',
      };

      final transfer = Transfer.fromJson(json);

      expect(transfer.status, TransferStatus.completed);
      expect(transfer.toJson()['status'], 'completed');
    });

    test('accepts uppercase API states including reversed', () {
      final transfer = Transfer.fromJson({
        'id': 't2',
        'recipientId': 'r1',
        'amount': 25,
        'sourceCurrency': 'USD',
        'targetCurrency': 'HTG',
        'fee': 2,
        'exchangeRate': 130,
        'amountReceived': 3250,
        'status': 'REVERSED',
        'createdAt': '2024-01-01T00:00:00.000Z',
      });

      expect(transfer.status, TransferStatus.reversed);
    });
  });
}
