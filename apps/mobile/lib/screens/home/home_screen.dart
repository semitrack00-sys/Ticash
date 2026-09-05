import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/routes.dart';
import '../../config/theme.dart';
import '../../localization/app_localizations.dart';
import '../../models/transfer.dart';
import '../../providers/auth_provider.dart';
import '../../providers/recipients_provider.dart';
import '../../providers/transfer_provider.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/transfer_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authNotifierProvider).valueOrNull;
    return AppShell(
      currentIndex: 0,
      title: context.tr('hiName', {
        'name': user?.firstName ?? context.tr('there'),
      }),
      actions: [
        Padding(
          padding: const EdgeInsets.only(right: 14),
          child: IconButton.filledTonal(
            tooltip: context.tr('profile'),
            onPressed: () => context.go(AppRoutes.profile),
            icon: Text(
              (user?.firstName.isNotEmpty ?? false)
                  ? user!.firstName.substring(0, 1).toUpperCase()
                  : 'T',
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
        ),
      ],
      body: const _HomeBody(),
    );
  }
}

class _HomeBody extends ConsumerWidget {
  const _HomeBody();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(transferHistoryProvider);
    final recipients = ref.watch(recipientsProvider);
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(transferHistoryProvider);
        await ref.read(recipientsProvider.notifier).load();
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 30),
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: AppTheme.navy,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.public_rounded,
                  color: AppTheme.gold,
                  size: 30,
                ),
                const SizedBox(height: 20),
                Text(
                  context.tr('sendSupportHome'),
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  context.tr('quoteSubtitle'),
                  style: const TextStyle(
                    color: Color(0xFFCBD5E1),
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 22),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => context.go(AppRoutes.transfer),
                    icon: const Icon(Icons.arrow_outward_rounded),
                    label: Text(context.tr('startTransfer')),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),
          history.when(
            loading: () => const _MetricsSkeleton(),
            error: (_, __) => _InlineError(
              message: context.tr('transferSummaryUnavailable'),
              onRetry: () => ref.invalidate(transferHistoryProvider),
            ),
            data: (items) => _Metrics(items: items),
          ),
          const SizedBox(height: 28),
          _SectionHeader(
            title: context.tr('recipients'),
            action: context.tr('viewAll'),
            onTap: () => context.go(AppRoutes.recipients),
          ),
          const SizedBox(height: 12),
          recipients.when(
            loading: () => const LinearProgressIndicator(minHeight: 3),
            error: (_, __) => _InlineError(
              message: context.tr('recipientsLoadFailed'),
              onRetry: () => ref.read(recipientsProvider.notifier).load(),
            ),
            data: (items) => items.isEmpty
                ? _EmptyCard(
                    icon: Icons.person_add_alt_1_outlined,
                    title: context.tr('noRecipients'),
                    message: context.tr('addRecipientBeforeTransfer'),
                    action: context.tr('add'),
                    onTap: () => context.go(AppRoutes.recipients),
                  )
                : SizedBox(
                    height: 104,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: items.take(5).length,
                      separatorBuilder: (_, __) => const SizedBox(width: 12),
                      itemBuilder: (context, index) {
                        final item = items[index];
                        return InkWell(
                          borderRadius: BorderRadius.circular(18),
                          onTap: () => context.go(AppRoutes.transfer),
                          child: Container(
                            width: 185,
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              border: Border.all(color: AppTheme.border),
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: Row(
                              children: [
                                CircleAvatar(
                                  backgroundColor: const Color(0xFFFFF4D6),
                                  foregroundColor: AppTheme.navy,
                                  child: Text(
                                    item.fullName.substring(0, 1).toUpperCase(),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        item.fullName,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        item.payoutMethod ??
                                            context.tr('haitiWallet'),
                                        style: const TextStyle(
                                          color: AppTheme.muted,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  ),
          ),
          const SizedBox(height: 28),
          _SectionHeader(
            title: context.tr('recentTransfers'),
            action: context.tr('seeHistory'),
            onTap: () => context.go(AppRoutes.activity),
          ),
          const SizedBox(height: 8),
          history.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) => const SizedBox.shrink(),
            data: (items) => items.isEmpty
                ? _EmptyCard(
                    icon: Icons.receipt_long_outlined,
                    title: context.tr('noTransfers'),
                    message: context.tr('submittedTransfersHere'),
                    action: context.tr('send'),
                    onTap: () => context.go(AppRoutes.transfer),
                  )
                : Column(
                    children: items
                        .take(3)
                        .map((item) => TransferCard(transfer: item))
                        .toList(),
                  ),
          ),
        ],
      ),
    );
  }
}

class _Metrics extends StatelessWidget {
  const _Metrics({required this.items});
  final List<Transfer> items;
  @override
  Widget build(BuildContext context) {
    final sent = items.fold<double>(0, (sum, item) => sum + item.amount);
    final active = items
        .where(
          (item) =>
              item.status == TransferStatus.pending ||
              item.status == TransferStatus.processing,
        )
        .length;
    return Row(
      children: [
        Expanded(
          child: _Metric(
            label: context.tr('usdSubmitted'),
            value: '\$${sent.toStringAsFixed(2)}',
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _Metric(label: context.tr('inProgress'), value: '$active'),
        ),
      ],
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: AppTheme.border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: AppTheme.muted, fontSize: 12),
        ),
        const SizedBox(height: 7),
        Text(
          value,
          style: const TextStyle(
            color: AppTheme.navy,
            fontSize: 22,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    ),
  );
}

class _MetricsSkeleton extends StatelessWidget {
  const _MetricsSkeleton();
  @override
  Widget build(BuildContext context) => const Row(
    children: [
      Expanded(child: LinearProgressIndicator(minHeight: 72)),
      SizedBox(width: 12),
      Expanded(child: LinearProgressIndicator(minHeight: 72)),
    ],
  );
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.action,
    required this.onTap,
  });
  final String title;
  final String action;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
        ),
      ),
      TextButton(onPressed: onTap, child: Text(action)),
    ],
  );
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      leading: const Icon(Icons.cloud_off_outlined),
      title: Text(message),
      trailing: TextButton(
        onPressed: onRetry,
        child: Text(context.tr('retry')),
      ),
    ),
  );
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({
    required this.icon,
    required this.title,
    required this.message,
    required this.action,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final String message;
  final String action;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          Icon(icon, size: 30, color: AppTheme.gold),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 4),
                Text(message, style: const TextStyle(color: AppTheme.muted)),
              ],
            ),
          ),
          TextButton(onPressed: onTap, child: Text(action)),
        ],
      ),
    ),
  );
}
