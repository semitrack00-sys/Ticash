import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../localization/app_localizations.dart';
import '../models/transfer.dart';
import 'package:go_router/go_router.dart';

class TransferCard extends StatelessWidget {
  const TransferCard({super.key, required this.transfer});
  final Transfer transfer;

  @override
  Widget build(BuildContext context) {
    final color = _statusColor(transfer.status);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => context.push('/activity/${transfer.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: color.withValues(alpha: .1),
                foregroundColor: color,
                child: Icon(_statusIcon(transfer.status)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${transfer.amount.toStringAsFixed(2)} ${transfer.sourceCurrency}',
                      style: const TextStyle(
                        fontWeight: FontWeight.w900,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${_providerLabel(context, transfer.payoutMethod)} • ${transfer.recipientPhone ?? context.tr('recipient')}',
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: .1),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      _statusLabel(context, transfer.status),
                      style: TextStyle(
                        color: color,
                        fontWeight: FontWeight.w800,
                        fontSize: 10,
                      ),
                    ),
                  ),
                  const SizedBox(height: 7),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: AppTheme.muted,
                    size: 19,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _statusColor(TransferStatus status) {
    switch (status) {
      case TransferStatus.completed:
        return AppTheme.success;
      case TransferStatus.failed:
      case TransferStatus.cancelled:
        return AppTheme.error;
      case TransferStatus.reversed:
        return const Color(0xFFB54708);
      case TransferStatus.processing:
        return const Color(0xFF175CD3);
      case TransferStatus.pending:
        return const Color(0xFFB54708);
    }
  }

  IconData _statusIcon(TransferStatus status) {
    switch (status) {
      case TransferStatus.completed:
        return Icons.check_rounded;
      case TransferStatus.failed:
      case TransferStatus.cancelled:
        return Icons.close_rounded;
      case TransferStatus.reversed:
        return Icons.undo_rounded;
      case TransferStatus.processing:
        return Icons.sync_rounded;
      case TransferStatus.pending:
        return Icons.schedule_rounded;
    }
  }

  String _statusLabel(BuildContext context, TransferStatus status) {
    switch (status) {
      case TransferStatus.completed:
        return context.tr('completed');
      case TransferStatus.failed:
        return context.tr('failed');
      case TransferStatus.cancelled:
        return context.tr('cancelled');
      case TransferStatus.reversed:
        return context.tr('reversed');
      case TransferStatus.processing:
        return context.tr('processing');
      case TransferStatus.pending:
        return context.tr('pending');
    }
  }

  String _providerLabel(BuildContext context, String? provider) {
    switch (provider) {
      case 'MONCASH':
        return 'MonCash';
      case 'NATCASH':
        return 'NatCash';
      default:
        return context.tr('haitiWallet');
    }
  }
}
