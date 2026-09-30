import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'package:ticash/screens/topup/receiver_value_summary.dart';

void main() {
  testWidgets('review displays backend receiver currency without conversion', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ReceiverValueSummary(amount: 1320.12345, currency: 'HTG'),
        ),
      ),
    );
    expect(find.text('Receiver gets'), findsOneWidget);
    expect(find.text('1320.12345 HTG'), findsOneWidget);
    expect(find.textContaining('USD'), findsNothing);
  });
  testWidgets('receipt preserves quoted and actual values and discrepancy', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ReceiverValueSummary(
            amount: 655,
            currency: 'HTG',
            isReceipt: true,
            confirmed: true,
            quotedAmount: 650,
            quotedCurrency: 'HTG',
            discrepancy: true,
          ),
        ),
      ),
    );
    expect(find.text('655.0 HTG'), findsOneWidget);
    expect(find.text('Quoted receiver amount: 650 HTG'), findsOneWidget);
    expect(find.textContaining('reconciliation'), findsOneWidget);
  });
  testWidgets('pending receipt never claims the expected value was delivered', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ReceiverValueSummary(
            amount: 655,
            currency: 'HTG',
            isReceipt: true,
          ),
        ),
      ),
    );
    expect(find.text('Awaiting provider confirmation'), findsOneWidget);
    expect(find.text('655.0 HTG'), findsNothing);
  });
  test(
    'transaction parser preserves snapshot separately from provider-confirmed delivery',
    () {
      final transaction = MobileTopUpTransaction.fromJson({
        'id': 'fixture',
        'recipientPhone': '+50937123456',
        'countryCode': 'HT',
        'operatorName': 'Fixture operator',
        'productName': 'Fixture product',
        'kind': 'AIRTIME',
        'providerAmount': 5,
        'providerCurrency': 'USD',
        'feeUsd': 0.99,
        'totalChargeUsd': 5.99,
        'deliveredValue': 655,
        'deliveredCurrency': 'HTG',
        'status': 'DELIVERED',
        'receiverQuote': {'amount': 650, 'currency': 'HTG'},
        'receiverDiscrepancy': true,
        'createdAt': '2026-09-29T00:00:00Z',
      });
      expect(transaction.receiverQuote?['amount'], 650);
      expect(transaction.deliveredValue, 655);
      expect(transaction.providerCurrency, 'USD');
      expect(transaction.receiverDiscrepancy, true);
    },
  );
}
