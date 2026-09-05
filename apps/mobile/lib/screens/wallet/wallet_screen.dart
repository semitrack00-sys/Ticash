import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/routes.dart';
import '../../config/theme.dart';
import '../../localization/app_localizations.dart';
import '../../widgets/app_navigation_bar.dart';
import '../../providers/transfer_provider.dart';

class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(transferHistoryProvider);
    return Scaffold(
      appBar: AppNavigationBar(title: context.tr('wallet')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Container(
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              color: AppTheme.primary,
              borderRadius: BorderRadius.circular(24),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.tr('transferAccount'),
                  style: const TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 8),
                Text(
                  context.tr('noStoredBalance'),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 34,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  history.valueOrNull == null
                      ? context.tr('loadingActivity')
                      : context.tr('transfersRecorded', {
                          'count': history.valueOrNull!.length,
                        }),
                  style: const TextStyle(color: Colors.white70),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Text(
            context.tr('fundingStatus'),
            style: Theme.of(context).textTheme.titleLarge,
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.credit_card),
              title: Text(context.tr('fundingNotConnected')),
              subtitle: Text(context.tr('fundingProviderRequired')),
              trailing: const Icon(Icons.lock_outline),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.qr_code),
              title: Text(context.tr('qrUnavailable')),
              subtitle: Text(context.tr('sandboxNoFunds')),
              trailing: const Icon(Icons.lock_outline),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: () => context.go(AppRoutes.transfer),
            icon: const Icon(Icons.send),
            label: Text(context.tr('sendToHaiti')),
          ),
        ],
      ),
    );
  }
}
