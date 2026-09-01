import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/transaction.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';

/// Renders a single row in the recent activity list: avatar/initial,
/// transaction type, recipient/source, amount and status.
class TransactionItem extends StatelessWidget {
  const TransactionItem({super.key, required this.transaction});

  final Transaction transaction;

  Color get _statusColor {
    switch (transaction.status) {
      case TransactionStatus.completed:
        return AppColors.success;
      case TransactionStatus.pending:
        return AppColors.pending;
      case TransactionStatus.failed:
        return AppColors.error;
    }
  }

  String get _statusLabel {
    switch (transaction.status) {
      case TransactionStatus.completed:
        return 'Completed';
      case TransactionStatus.pending:
        return 'Pending';
      case TransactionStatus.failed:
        return 'Failed';
    }
  }

  @override
  Widget build(BuildContext context) {
    final formatter = NumberFormat.currency(symbol: r'$', decimalDigits: 2);
    final amountText =
        '${transaction.isCredit ? '+' : '-'}${formatter.format(transaction.amount.abs())}';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: AppColors.primary,
            child: Text(
              transaction.avatarInitial,
              style: AppTextStyles.subheading,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(transaction.title, style: AppTextStyles.body),
                const SizedBox(height: 2),
                Text(transaction.subtitle, style: AppTextStyles.small),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                amountText,
                style: AppTextStyles.body.copyWith(
                  fontWeight: FontWeight.w600,
                  color: transaction.isCredit ? AppColors.success : AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                _statusLabel,
                style: AppTextStyles.small.copyWith(color: _statusColor),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
