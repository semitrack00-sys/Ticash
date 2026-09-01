import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/navigation_provider.dart';
import '../theme/app_colors.dart';

/// Metadata for a navigation destination, shared between the bottom
/// navigation bar (phones) and the sidebar (wide screens).
class _NavItem {
  const _NavItem(this.section, this.label, this.icon);

  final AppSection section;
  final String label;
  final IconData icon;
}

const _navItems = [
  _NavItem(AppSection.home, 'Home', Icons.home_rounded),
  _NavItem(AppSection.sendMoney, 'Send money', Icons.send_rounded),
  _NavItem(AppSection.wallet, 'Wallet', Icons.account_balance_wallet_rounded),
  _NavItem(AppSection.activity, 'Activity', Icons.receipt_long_rounded),
  _NavItem(AppSection.profile, 'Profile', Icons.person_rounded),
];

/// Responsive app navigation: a bottom tab bar on narrow (phone) layouts
/// and a sidebar on wide layouts, matching the mockup's section list
/// (Home, Send money, Wallet, Activity, Profile).
class AppNavigation extends ConsumerWidget {
  const AppNavigation({super.key, required this.isSidebar});

  /// When true, renders as a vertical sidebar; otherwise a bottom bar.
  final bool isSidebar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(currentSectionProvider);

    if (isSidebar) {
      return Container(
        width: 220,
        color: AppColors.primaryDark,
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 24),
              child: Text(
                'TiCash',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(height: 24),
            for (final item in _navItems)
              ListTile(
                leading: Icon(
                  item.icon,
                  color: current == item.section ? AppColors.secondary : AppColors.textSecondary,
                ),
                title: Text(
                  item.label,
                  style: TextStyle(
                    color: current == item.section ? AppColors.secondary : AppColors.textSecondary,
                    fontWeight: current == item.section ? FontWeight.w600 : FontWeight.normal,
                  ),
                ),
                selected: current == item.section,
                selectedTileColor: AppColors.surface,
                onTap: () => ref.read(currentSectionProvider.notifier).state = item.section,
              ),
          ],
        ),
      );
    }

    return BottomNavigationBar(
      currentIndex: _navItems.indexWhere((item) => item.section == current),
      onTap: (index) =>
          ref.read(currentSectionProvider.notifier).state = _navItems[index].section,
      items: [
        for (final item in _navItems)
          BottomNavigationBarItem(icon: Icon(item.icon), label: item.label),
      ],
    );
  }
}
