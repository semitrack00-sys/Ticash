import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/transfer_provider.dart';
import '../../widgets/primary_button.dart';

class TransferScreen extends ConsumerWidget {
  const TransferScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final draft = ref.watch(transferDraftProvider);
    final notifier = ref.read(transferDraftProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Send Money')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            TextField(
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Amount to send (USD)',
              ),
              onChanged: (value) {
                notifier.updateAmount(double.tryParse(value) ?? 0);
              },
            ),
            const SizedBox(height: 24),
            Text('Amount: \$${draft.amount.toStringAsFixed(2)}'),
            const Spacer(),
            PrimaryButton(
              label: 'Continue',
              onPressed: draft.amount > 0 ? () {} : null,
            ),
          ],
        ),
      ),
    );
  }
}
