import 'package:flutter/material.dart';

import '../../config/theme.dart';
import '../../localization/app_localizations.dart';
import '../../widgets/app_navigation_bar.dart';

class SupportScreen extends StatelessWidget {
  const SupportScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppNavigationBar(title: context.tr('helpSafety')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 30),
        children: [
          Text(
            context.tr('helpSafety'),
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          Text(context.tr('sandboxNotice')),
          const SizedBox(height: 20),
          _SupportCard(
            icon: Icons.shield_outlined,
            title: context.tr('protectAccount'),
            body: context.tr('protectAccountBody'),
          ),
          _SupportCard(
            icon: Icons.receipt_long_outlined,
            title: context.tr('transferAssistance'),
            body: context.tr('transferAssistanceBody'),
          ),
          _SupportCard(
            icon: Icons.privacy_tip_outlined,
            title: context.tr('privacy'),
            body: context.tr('privacyBody'),
          ),
          _SupportCard(
            icon: Icons.gavel_outlined,
            title: context.tr('termsFees'),
            body: context.tr('termsFeesBody'),
          ),
          const SizedBox(height: 12),
          Text(
            context.tr('testingHelp'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _SupportCard extends StatelessWidget {
  const _SupportCard({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: AppTheme.gold),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 6),
                  Text(body),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
