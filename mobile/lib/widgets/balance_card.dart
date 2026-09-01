import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../providers/user_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';

/// Displays the user's available balance with a visibility toggle,
/// matching the "Available balance / $2,485.60 USD" block in the mockup.
class BalanceCard extends ConsumerWidget {
  const BalanceCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(userProvider);
    final isVisible = ref.watch(balanceVisibleProvider);
    final formatter = NumberFormat.currency(symbol: r'$', decimalDigits: 2);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Available balance', style: AppTextStyles.bodySecondary),
              IconButton(
                icon: Icon(
                  isVisible ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                  color: AppColors.textSecondary,
                ),
                tooltip: isVisible ? 'Hide balance' : 'Show balance',
                onPressed: () =>
                    ref.read(balanceVisibleProvider.notifier).state = !isVisible,
              ),
            ],
          ),
          const SizedBox(height: 4),
          userAsync.when(
            data: (user) => Text(
              isVisible
                  ? '${formatter.format(user.availableBalance)} ${user.currency}'
                  : '•••••• ${user.currency}',
              style: AppTextStyles.heading,
            ),
            loading: () => const SizedBox(
              height: 36,
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
            error: (error, stackTrace) => const Text(
              'Unable to load balance',
              style: AppTextStyles.bodySecondary,
            ),
          ),
        ],
      ),
    ).animate().fadeIn(duration: 300.ms).slideY(begin: 0.05, end: 0);
  }
}
