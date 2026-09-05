import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../config/routes.dart';
import '../localization/app_localizations.dart';
import 'language_selector.dart';

/// A consistent header for authenticated secondary pages.
class AppNavigationBar extends StatelessWidget implements PreferredSizeWidget {
  const AppNavigationBar({
    super.key,
    required this.title,
    this.actions = const [],
  });

  final String title;
  final List<Widget> actions;

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      leading: IconButton(
        tooltip: context.tr('back'),
        icon: const Icon(Icons.arrow_back),
        onPressed: () {
          if (context.canPop()) {
            context.pop();
          } else {
            context.go(AppRoutes.home);
          }
        },
      ),
      title: Text(title),
      actions: [
        IconButton(
          tooltip: context.tr('home'),
          icon: const Icon(Icons.home_outlined),
          onPressed: () => context.go(AppRoutes.home),
        ),
        ...actions,
        const LanguageSelector(),
      ],
    );
  }
}
