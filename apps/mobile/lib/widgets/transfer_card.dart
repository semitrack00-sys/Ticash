import 'package:flutter/material.dart';

import '../models/transfer.dart';

/// Displays a single transfer entry in a list (history, home screen, etc).
class TransferCard extends StatelessWidget {
  const TransferCard({super.key, required this.transfer});

  final Transfer transfer;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
      child: ListTile(
        leading: CircleAvatar(
          child: Icon(_iconForStatus(transfer.status)),
        ),
        title: Text(
          '${transfer.amount.toStringAsFixed(2)} ${transfer.sourceCurrency}',
        ),
        subtitle: Text('To recipient ${transfer.recipientId}'),
        trailing: Text(transfer.status.name.toUpperCase()),
      ),
    );
  }

  IconData _iconForStatus(TransferStatus status) {
    switch (status) {
      case TransferStatus.completed:
        return Icons.check_circle;
      case TransferStatus.failed:
        return Icons.error;
      case TransferStatus.cancelled:
        return Icons.cancel;
      case TransferStatus.processing:
        return Icons.autorenew;
      case TransferStatus.pending:
        return Icons.schedule;
    }
  }
}
