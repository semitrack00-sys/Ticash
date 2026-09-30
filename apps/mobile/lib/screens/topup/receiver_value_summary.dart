import 'package:flutter/material.dart';

/// Monetary values are supplied by the backend; this widget never converts FX.
class ReceiverValueSummary extends StatelessWidget {
  const ReceiverValueSummary({
    super.key,
    required this.currency,
    this.amount,
    this.isReceipt = false,
    this.confirmed = false,
    this.quotedAmount,
    this.quotedCurrency,
    this.discrepancy = false,
  });

  final double? amount;
  final String currency;
  final bool isReceipt;
  final bool confirmed;
  final num? quotedAmount;
  final String? quotedCurrency;
  final bool discrepancy;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          isReceipt ? 'Receiver credited' : 'Receiver gets',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        Text(
          amount != null && (!isReceipt || confirmed)
              ? '$amount $currency'
              : 'Awaiting provider confirmation',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        if (isReceipt && quotedAmount != null && quotedCurrency != null)
          Text('Quoted receiver amount: $quotedAmount $quotedCurrency'),
        if (discrepancy)
          const Text(
            'Provider delivery differs from the quote. Recorded for reconciliation.',
          ),
      ],
    ),
  );
}
