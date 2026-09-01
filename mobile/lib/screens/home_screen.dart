import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/navigation_provider.dart';
import '../providers/transaction_provider.dart';
import '../providers/user_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import '../widgets/balance_card.dart';
import '../widgets/quick_action_buttons.dart';
import '../widgets/recent_activity_list.dart';
import '../widgets/send_abroad_promo.dart';

/// Returns a time-of-day greeting such as "GOOD MORNING", matching the
/// mockup's header.
String _greeting() {
  final hour = DateTime.now().hour;
  if (hour < 12) return 'GOOD MORNING';
  if (hour < 18) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

/// Main dashboard screen: greeting header, balance card, quick actions,
/// recent activity and the "Send abroad" promo panel.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  Future<void> _onRefresh(WidgetRef ref) async {
    ref.read(userProvider.notifier).refresh();
    await ref.read(transactionsProvider.notifier).refresh();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(userProvider);

    return RefreshIndicator(
      onRefresh: () => _onRefresh(ref),
      color: AppColors.primaryDark,
      backgroundColor: AppColors.secondary,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              const Icon(Icons.shield_outlined, size: 16, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              const Text('Secure wallet', style: AppTextStyles.small),
              const SizedBox(width: 16),
              Icon(
                Icons.verified_outlined,
                size: 16,
                color: userAsync.value?.isIdentityVerified ?? false
                    ? AppColors.success
                    : AppColors.textSecondary,
              ),
              const SizedBox(width: 6),
              const Text('Identity verified', style: AppTextStyles.small),
            ],
          ),
          const SizedBox(height: 20),
          Text(_greeting(), style: AppTextStyles.small),
          const SizedBox(height: 4),
          const Text(
            'Your money, ready when you are.',
            style: AppTextStyles.heading,
          ),
          const SizedBox(height: 20),
          const BalanceCard(),
          const SizedBox(height: 20),
          QuickActionButtons(
            onSendMoney: () =>
                ref.read(currentSectionProvider.notifier).state = AppSection.sendMoney,
            onAddMoney: () =>
                ref.read(currentSectionProvider.notifier).state = AppSection.wallet,
            onMyQr: () {},
          ),
          const SizedBox(height: 28),
          const RecentActivityList(),
          const SizedBox(height: 28),
          SendAbroadPromo(
            onStartTransfer: () =>
                ref.read(currentSectionProvider.notifier).state = AppSection.sendMoney,
          ),
          const SizedBox(height: 20),
        ],
      ),
    ).animate().fadeIn(duration: 250.ms);
  }
}
