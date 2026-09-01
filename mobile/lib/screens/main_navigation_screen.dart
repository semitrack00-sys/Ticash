import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/navigation_provider.dart';
import '../theme/app_colors.dart';
import '../widgets/app_navigation.dart';
import 'activity_screen.dart';
import 'home_screen.dart';
import 'profile_screen.dart';
import 'send_money_screen.dart';
import 'wallet_screen.dart';

/// Breakpoint above which the app switches from a bottom tab bar to a
/// sidebar, matching the mockup's sidebar navigation on larger screens.
const double _sidebarBreakpoint = 700;

/// Hosts the currently selected [AppSection] and renders the responsive
/// navigation (sidebar on wide screens, bottom tabs on phones).
class MainNavigationScreen extends ConsumerWidget {
  const MainNavigationScreen({super.key});

  Widget _screenFor(AppSection section) {
    switch (section) {
      case AppSection.home:
        return const HomeScreen();
      case AppSection.sendMoney:
        return const SendMoneyScreen();
      case AppSection.wallet:
        return const WalletScreen();
      case AppSection.activity:
        return const ActivityScreen();
      case AppSection.profile:
        return const ProfileScreen();
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final section = ref.watch(currentSectionProvider);
    final isWide = MediaQuery.sizeOf(context).width >= _sidebarBreakpoint;

    if (isWide) {
      return Scaffold(
        backgroundColor: AppColors.primaryDark,
        body: Row(
          children: [
            const AppNavigation(isSidebar: true),
            Expanded(child: SafeArea(child: _screenFor(section))),
          ],
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.primaryDark,
      body: SafeArea(child: _screenFor(section)),
      bottomNavigationBar: const AppNavigation(isSidebar: false),
    );
  }
}
