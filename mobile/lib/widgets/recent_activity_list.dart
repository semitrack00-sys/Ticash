import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/transaction_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import 'transaction_item.dart';

/// Scrollable "Recent activity" section, with a header and a "See all"
/// action, matching the mockup.
class RecentActivityList extends ConsumerWidget {
  const RecentActivityList({super.key, this.onSeeAll});

  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final transactionsAsync = ref.watch(transactionsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Recent activity', style: AppTextStyles.subheading),
            TextButton(
              onPressed: onSeeAll,
              child: const Text(
                'See all',
                style: TextStyle(color: AppColors.textSecondary),
              ),
            ),
          ],
        ),
        transactionsAsync.when(
          data: (transactions) {
            if (transactions.isEmpty) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('No activity yet.', style: AppTextStyles.bodySecondary),
              );
            }
            return Column(
              children: [
                for (var i = 0; i < transactions.length; i++)
                  TransactionItem(transaction: transactions[i])
                      .animate()
                      .fadeIn(delay: (i * 60).ms, duration: 250.ms)
                      .slideX(begin: 0.03, end: 0),
              ],
            );
          },
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          ),
          error: (error, stackTrace) => const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Text(
              'Could not load recent activity.',
              style: AppTextStyles.bodySecondary,
            ),
          ),
        ),
      ],
    );
  }
}
