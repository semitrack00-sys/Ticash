import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/routes.dart';
import '../../config/theme.dart';
import '../../localization/app_localizations.dart';
import '../../providers/transfer_provider.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/transfer_card.dart';

class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(transferHistoryProvider);
    return AppShell(
      currentIndex: 2,
      title: context.tr('transfers'),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go(AppRoutes.transfer),
        backgroundColor: AppTheme.gold,
        foregroundColor: AppTheme.navy,
        icon: const Icon(Icons.add_rounded),
        label: Text(context.tr('newTransfer')),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(transferHistoryProvider),
        child: history.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      const Icon(Icons.cloud_off_outlined, size: 42),
                      const SizedBox(height: 12),
                      Text(context.tr('historyUnavailable')),
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: () =>
                            ref.invalidate(transferHistoryProvider),
                        child: Text(context.tr('tryAgain')),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          data: (transfers) => transfers.isEmpty
              ? ListView(
                  padding: const EdgeInsets.all(24),
                  children: [
                    const SizedBox(height: 80),
                    const Icon(
                      Icons.receipt_long_outlined,
                      size: 58,
                      color: AppTheme.muted,
                    ),
                    const SizedBox(height: 18),
                    Text(
                      context.tr('noTransfers'),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      context.tr('historyEmptyBody'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppTheme.muted),
                    ),
                  ],
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(20, 22, 20, 100),
                  children: [
                    Text(
                      context.tr('transferHistory'),
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      context.tr('transferHistoryBody'),
                      style: const TextStyle(color: AppTheme.muted),
                    ),
                    const SizedBox(height: 20),
                    ...transfers.map((item) => TransferCard(transfer: item)),
                  ],
                ),
        ),
      ),
    );
  }
}
