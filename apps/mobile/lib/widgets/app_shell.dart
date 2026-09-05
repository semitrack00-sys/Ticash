import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../config/routes.dart';
import '../config/theme.dart';
import '../localization/app_localizations.dart';
import 'brand_logo.dart';
import 'language_selector.dart';

class AppShell extends StatelessWidget {
  const AppShell({
    super.key,
    required this.currentIndex,
    required this.body,
    this.title,
    this.actions = const [],
    this.floatingActionButton,
  });

  final int currentIndex;
  final Widget body;
  final String? title;
  final List<Widget> actions;
  final Widget? floatingActionButton;

  static const _routes = [
    AppRoutes.home,
    AppRoutes.recipients,
    AppRoutes.activity,
    AppRoutes.profile,
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        titleSpacing: 20,
        title: Row(
          children: [
            const BrandLogo(height: 38),
            const SizedBox(width: 12),
            Text(title ?? 'TiCash'),
          ],
        ),
        actions: [...actions, const LanguageSelector()],
      ),
      body: body,
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: (index) => context.go(_routes[index]),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.home_outlined, color: Color(0xFFCBD5E1)),
            selectedIcon: const Icon(Icons.home_rounded, color: AppTheme.gold),
            label: context.tr('home'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.people_outline, color: Color(0xFFCBD5E1)),
            selectedIcon: const Icon(Icons.people, color: AppTheme.gold),
            label: context.tr('recipients'),
          ),
          NavigationDestination(
            icon: const Icon(
              Icons.swap_horiz_rounded,
              color: Color(0xFFCBD5E1),
            ),
            selectedIcon: const Icon(Icons.receipt_long, color: AppTheme.gold),
            label: context.tr('transfers'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.person_outline, color: Color(0xFFCBD5E1)),
            selectedIcon: const Icon(Icons.person, color: AppTheme.gold),
            label: context.tr('profile'),
          ),
        ],
      ),
    );
  }
}
