import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/routes.dart';
import '../../config/theme.dart';
import '../../models/transfer.dart';
import '../../providers/auth_provider.dart';
import '../../services/admin_service.dart';
import '../../widgets/app_navigation_bar.dart';

final adminWorkspaceProvider = FutureProvider<AdminWorkspace>(
  (ref) => AdminService().workspace(),
);

class AdminScreen extends ConsumerStatefulWidget {
  const AdminScreen({super.key});
  @override
  ConsumerState<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends ConsumerState<AdminScreen> {
  int _section = 0;
  static const _destinations = [
    (Icons.space_dashboard_outlined, 'Overview'),
    (Icons.fact_check_outlined, 'Review queue'),
    (Icons.swap_horiz, 'Transfers'),
    (Icons.hub_outlined, 'Providers'),
    (Icons.policy_outlined, 'Controls'),
  ];

  @override
  Widget build(BuildContext context) {
    final workspace = ref.watch(adminWorkspaceProvider);
    return Scaffold(
      backgroundColor: AppTheme.offWhite,
      appBar: AppNavigationBar(
        title: 'TiCash Operations',
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: () => ref.invalidate(adminWorkspaceProvider),
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: () async {
              await ref.read(authNotifierProvider.notifier).logout();
              if (context.mounted) context.go(AppRoutes.login);
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: workspace.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _ErrorState(
          error: error,
          retry: () => ref.invalidate(adminWorkspaceProvider),
        ),
        data: (data) => LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= 900;
            final page = _page(data);
            if (wide) {
              return Row(
                children: [
                  NavigationRail(
                    backgroundColor: Colors.white,
                    selectedIndex: _section,
                    onDestinationSelected: (value) =>
                        setState(() => _section = value),
                    labelType: NavigationRailLabelType.all,
                    leading: Padding(
                      padding: const EdgeInsets.only(bottom: 18),
                      child: _EnvironmentBadge(
                        environment: data.session.environment,
                      ),
                    ),
                    destinations: _destinations
                        .map(
                          (item) => NavigationRailDestination(
                            icon: Icon(item.$1),
                            selectedIcon: Icon(item.$1),
                            label: Text(item.$2),
                          ),
                        )
                        .toList(),
                  ),
                  const VerticalDivider(width: 1),
                  Expanded(child: page),
                ],
              );
            }
            return Column(
              children: [
                Material(
                  color: Colors.white,
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    child: Row(
                      children: List.generate(
                        _destinations.length,
                        (index) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            selected: _section == index,
                            avatar: Icon(_destinations[index].$1, size: 18),
                            label: Text(_destinations[index].$2),
                            onSelected: (_) => setState(() => _section = index),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                Expanded(child: page),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _page(AdminWorkspace data) => switch (_section) {
    0 => _OverviewPage(
      data: data,
      onRefresh: () => ref.invalidate(adminWorkspaceProvider),
    ),
    1 => _ReviewPage(
      data: data,
      onChanged: () => ref.invalidate(adminWorkspaceProvider),
    ),
    2 => _TransfersPage(data: data),
    3 => _ProvidersPage(
      data: data,
      onChanged: () => ref.invalidate(adminWorkspaceProvider),
    ),
    _ => _ControlsPage(
      data: data,
      onChanged: () => ref.invalidate(adminWorkspaceProvider),
    ),
  };
}

class _PageShell extends StatelessWidget {
  const _PageShell({
    required this.title,
    required this.subtitle,
    required this.children,
  });
  final String title;
  final String subtitle;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: () async {},
    child: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(subtitle, style: const TextStyle(color: AppTheme.muted)),
        const SizedBox(height: 20),
        ...children,
      ],
    ),
  );
}

class _OverviewPage extends StatelessWidget {
  const _OverviewPage({required this.data, required this.onRefresh});
  final AdminWorkspace data;
  final VoidCallback onRefresh;
  @override
  Widget build(BuildContext context) {
    const metrics = [
      ('totalCustomers', 'Customers', Icons.people_outline),
      ('kycPending', 'KYC pending', Icons.hourglass_top),
      ('kycApproved', 'KYC approved', Icons.verified_user_outlined),
      ('kycDeclined', 'KYC declined', Icons.person_off_outlined),
      ('kycReview', 'KYC review', Icons.badge_outlined),
      ('transfersToday', 'Transfers today', Icons.today_outlined),
      ('transfersProcessing', 'Processing', Icons.sync),
      ('completedTransfers', 'Completed', Icons.check_circle_outline),
      ('failedTransfers', 'Failed', Icons.error_outline),
      ('complianceReviews', 'Compliance queue', Icons.fact_check_outlined),
      ('fundingFailures', 'Funding failures', Icons.account_balance_outlined),
      ('payoutFailures', 'Payout failures', Icons.mobile_friendly_outlined),
      ('reconciliationDiscrepancies', 'Discrepancies', Icons.rule_outlined),
    ];
    return _PageShell(
      title: 'Operations overview',
      subtitle:
          '${data.session.role.replaceAll('_', ' ')} · real database metrics',
      children: [
        const _SafetyBanner(),
        const SizedBox(height: 16),
        LayoutBuilder(
          builder: (context, constraints) {
            final count = constraints.maxWidth > 1100
                ? 5
                : constraints.maxWidth > 650
                ? 3
                : 2;
            return GridView.count(
              crossAxisCount: count,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              childAspectRatio: count == 2 ? 1.25 : 1.5,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              children: metrics
                  .map(
                    (item) => _Metric(
                      label: item.$2,
                      value: data.overview.metrics[item.$1] ?? 0,
                      icon: item.$3,
                    ),
                  )
                  .toList(),
            );
          },
        ),
        const SizedBox(height: 24),
        _SectionHeader(
          title: 'Customer accounts',
          action: Text('${data.overview.users.length} recent'),
        ),
        ...data.overview.users
            .take(8)
            .map(
              (user) => Card(
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: const Color(0xFFFFF4D6),
                    child: Text(
                      user.firstName.isEmpty ? '?' : user.firstName[0],
                    ),
                  ),
                  title: Text(user.fullName),
                  subtitle: Text(
                    '${user.email} · ${user.kycStatus.name.replaceAll(RegExp(r'(?=[A-Z])'), ' ')}',
                  ),
                  trailing: data.session.can('customers.restrict')
                      ? IconButton(
                          tooltip: 'Account controls',
                          icon: const Icon(Icons.admin_panel_settings_outlined),
                          onPressed: () => _restrictionDialog(
                            context,
                            user.id,
                            data.overview.accountStates[user.id] ?? const {},
                          ),
                        )
                      : const Icon(Icons.chevron_right),
                ),
              ),
            ),
      ],
    );
  }

  Future<void> _restrictionDialog(
    BuildContext context,
    String userId,
    Map<String, dynamic> state,
  ) async {
    var accountLocked = state['accountLocked'] as bool? ?? false;
    var fundingRestricted = state['fundingRestricted'] as bool? ?? false;
    var payoutRestricted = state['payoutRestricted'] as bool? ?? false;
    final reason = TextEditingController();
    final apply = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Account controls'),
          content: SizedBox(
            width: 440,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SwitchListTile(
                  title: const Text('Lock account access'),
                  value: accountLocked,
                  onChanged: (value) => setState(() => accountLocked = value),
                ),
                SwitchListTile(
                  title: const Text('Restrict funding'),
                  value: fundingRestricted,
                  onChanged: (value) =>
                      setState(() => fundingRestricted = value),
                ),
                SwitchListTile(
                  title: const Text('Restrict payout'),
                  value: payoutRestricted,
                  onChanged: (value) =>
                      setState(() => payoutRestricted = value),
                ),
                TextField(
                  controller: reason,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Required reason',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Apply controls'),
            ),
          ],
        ),
      ),
    );
    if (apply != true || reason.text.trim().length < 3) return;
    try {
      await AdminService().setRestrictions(
        userId,
        accountLocked: accountLocked,
        fundingRestricted: fundingRestricted,
        payoutRestricted: payoutRestricted,
        reason: reason.text.trim(),
      );
      onRefresh();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Account update failed: $error')),
        );
      }
    }
  }
}

class _ReviewPage extends StatelessWidget {
  const _ReviewPage({required this.data, required this.onChanged});
  final AdminWorkspace data;
  final VoidCallback onChanged;
  @override
  Widget build(BuildContext context) {
    if (!data.session.can('compliance.decide')) {
      return const _NoPermission(
        message:
            'Your role can view operations but cannot make compliance decisions.',
      );
    }
    final transfers = (data.reviews['transfers'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>();
    final customers = (data.reviews['customers'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>();
    return _PageShell(
      title: 'Review queue',
      subtitle:
          'Decisions require a reason and are written to the immutable audit trail.',
      children: [
        _SectionHeader(
          title: 'Transfer reviews',
          action: Chip(label: Text('${transfers.length} open')),
        ),
        if (transfers.isEmpty)
          const _EmptyCard(message: 'No transfers require compliance review.'),
        ...transfers.map(
          (item) => Card(
            child: ListTile(
              leading: const CircleAvatar(
                child: Icon(Icons.fact_check_outlined),
              ),
              title: Text(
                item['referenceNumber'] as String? ?? item['id'] as String,
              ),
              subtitle: Text(
                '${item['recipientName']} · ${(item['amount'] as num).toStringAsFixed(2)} ${item['sourceCurrency'] ?? 'USD'} · ${item['complianceStatus'] ?? 'REVIEW'}',
              ),
              trailing: FilledButton.tonal(
                onPressed: () =>
                    _complianceDialog(context, item['id'] as String),
                child: const Text('Review'),
              ),
            ),
          ),
        ),
        const SizedBox(height: 20),
        _SectionHeader(
          title: 'KYC provider queue',
          action: Text('${customers.length} open'),
        ),
        const _InfoCard(
          icon: Icons.verified_user_outlined,
          text:
              'Didit remains authoritative. This dashboard does not offer a manual “verified” switch.',
        ),
        ...customers.map(
          (item) => Card(
            child: ListTile(
              title: Text(item['name'] as String? ?? 'Customer'),
              subtitle: Text('${item['email']} · ${item['kycStatus']}'),
              trailing: const Icon(Icons.open_in_new),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _complianceDialog(
    BuildContext context,
    String transferId,
  ) async {
    final reason = TextEditingController();
    String decision = 'REVIEW';
    final submit = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Compliance decision'),
          content: SizedBox(
            width: 440,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: decision,
                  decoration: const InputDecoration(labelText: 'Decision'),
                  items: const ['CLEAR', 'REVIEW', 'BLOCKED']
                      .map(
                        (value) =>
                            DropdownMenuItem(value: value, child: Text(value)),
                      )
                      .toList(),
                  onChanged: (value) =>
                      setState(() => decision = value ?? 'REVIEW'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: reason,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Reason / analyst notes',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Record decision'),
            ),
          ],
        ),
      ),
    );
    if (submit != true || reason.text.trim().length < 3 || !context.mounted) {
      return;
    }
    try {
      await AdminService().decideCompliance(
        transferId,
        decision,
        reason.text.trim(),
      );
      onChanged();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Decision failed: $error')));
      }
    }
  }
}

class _TransfersPage extends StatelessWidget {
  const _TransfersPage({required this.data});
  final AdminWorkspace data;
  @override
  Widget build(BuildContext context) => _PageShell(
    title: 'Transfers',
    subtitle:
        'USD · CAD · EUR · MXN · BRL · CLP · DOP → Haiti (HTG) · actual states',
    children: [
      if (data.overview.transfers.isEmpty)
        const _EmptyCard(message: 'No transfer records found.'),
      ...data.overview.transfers.map(
        (transfer) => Card(
          child: ListTile(
            onTap: () => _showTransfer(context, transfer),
            leading: CircleAvatar(
              backgroundColor: _statusColor(
                transfer.status,
              ).withValues(alpha: .12),
              child: Icon(
                Icons.swap_horiz,
                color: _statusColor(transfer.status),
              ),
            ),
            title: Text(
              transfer.referenceNumber,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              '${transfer.recipientName} · ${transfer.amount.toStringAsFixed(2)} ${transfer.sourceCurrency} → ${transfer.amountReceived.toStringAsFixed(2)} HTG\n${transfer.stage.name}',
            ),
            isThreeLine: true,
            trailing: Chip(label: Text(transfer.status.name.toUpperCase())),
          ),
        ),
      ),
    ],
  );

  Color _statusColor(TransferStatus status) => switch (status) {
    TransferStatus.completed => AppTheme.success,
    TransferStatus.failed || TransferStatus.reversed => AppTheme.error,
    _ => AppTheme.gold,
  };

  void _showTransfer(
    BuildContext context,
    Transfer transfer,
  ) => showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(transfer.referenceNumber),
      content: SizedBox(
        width: 560,
        child: FutureBuilder<JsonMap>(
          future: AdminService().transferDetails(transfer.id),
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              return const SizedBox(
                height: 180,
                child: Center(child: CircularProgressIndicator()),
              );
            }
            final item = snapshot.data!['transfer'] as JsonMap;
            final sourceCurrency = item['sourceCurrency'] as String? ?? 'USD';
            final timeline = (item['timeline'] as List<dynamic>? ?? const [])
                .cast<JsonMap>();
            return SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Detail(
                    'Sender',
                    item['sender'] as String? ?? 'Protected customer',
                  ),
                  _Detail(
                    'Sender amount',
                    '${(item['amount'] as num).toStringAsFixed(2)} $sourceCurrency',
                  ),
                  _Detail(
                    'Exchange rate',
                    '1 $sourceCurrency = ${(item['exchangeRate'] as num).toStringAsFixed(4)} HTG',
                  ),
                  _Detail(
                    'TiCash fee',
                    '${(item['ticashFee'] as num).toStringAsFixed(2)} $sourceCurrency',
                  ),
                  _Detail(
                    'Provider fee',
                    '${(item['providerFundingFee'] as num).toStringAsFixed(2)} $sourceCurrency',
                  ),
                  _Detail('Recipient', item['recipientName'] as String? ?? '—'),
                  _Detail(
                    'Receives',
                    '${(item['amountReceived'] as num).toStringAsFixed(2)} HTG',
                  ),
                  _Detail(
                    'Payout method',
                    item['payoutMethod'] as String? ?? '—',
                  ),
                  _Detail(
                    'Funding status',
                    item['fundingStatus'] as String? ?? 'NOT_STARTED',
                  ),
                  _Detail(
                    'Compliance',
                    item['complianceStatus'] as String? ?? 'REVIEW',
                  ),
                  const Divider(height: 28),
                  Text(
                    'Transfer timeline',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  ...timeline.map(
                    (event) => ListTile(
                      dense: true,
                      leading: Icon(
                        event['complete'] == true
                            ? Icons.check_circle
                            : Icons.radio_button_unchecked,
                        color: event['complete'] == true
                            ? AppTheme.success
                            : AppTheme.muted,
                      ),
                      title: Text(event['state'] as String),
                      subtitle: Text(event['at'] as String? ?? 'Not reached'),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
      ],
    ),
  );
}

class _ProvidersPage extends StatelessWidget {
  const _ProvidersPage({required this.data, required this.onChanged});
  final AdminWorkspace data;
  final VoidCallback onChanged;
  @override
  Widget build(BuildContext context) {
    final services = (data.providers['services'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>();
    final payouts = (data.providers['payouts'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>();
    return _PageShell(
      title: 'Provider operations',
      subtitle:
          'Configuration and health only. Credentials are never returned to this app.',
      children: [
        const _SafetyBanner(),
        const SizedBox(height: 16),
        const _SectionHeader(
          title: 'Service boundaries',
          action: Text('No secrets shown'),
        ),
        ...services.map((item) {
          final status = item['status'] as Map<String, dynamic>? ?? const {};
          return Card(
            child: ListTile(
              leading: const Icon(Icons.hub_outlined),
              title: Text(item['id'] as String),
              subtitle: Text(
                '${item['kind']} · ${item['environment']}\n'
                '${status['recentEvents24h'] ?? 0} events · ${status['failedEvents24h'] ?? 0} failed (24h)',
              ),
              isThreeLine: true,
              trailing: Chip(label: Text(item['environment'] as String)),
            ),
          );
        }),
        const SizedBox(height: 20),
        const _SectionHeader(
          title: 'Haiti payout methods',
          action: Text('Backend controlled'),
        ),
        ...payouts.map(
          (item) => Card(
            child: ListTile(
              leading: const CircleAvatar(
                child: Icon(Icons.account_balance_wallet_outlined),
              ),
              title: Text((item['method'] as String).replaceAll('_', ' ')),
              subtitle: Text(
                '${item['environment']} · ${item['statusMessage'] ?? 'No status message'}\nVersion ${item['version']}',
              ),
              isThreeLine: true,
              trailing: data.session.can('providers.manage')
                  ? PopupMenuButton<String>(
                      onSelected: (state) => _changeState(context, item, state),
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'SANDBOX', child: Text('Sandbox')),
                        PopupMenuItem(
                          value: 'PENDING_APPROVAL',
                          child: Text('Pending approval'),
                        ),
                        PopupMenuItem(
                          value: 'SUSPENDED',
                          child: Text('Suspend'),
                        ),
                        PopupMenuItem(
                          value: 'DISABLED',
                          child: Text('Disable'),
                        ),
                      ],
                      child: Chip(label: Text(item['state'] as String)),
                    )
                  : Chip(label: Text(item['state'] as String)),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _changeState(
    BuildContext context,
    Map<String, dynamic> item,
    String state,
  ) async {
    final reason = TextEditingController();
    final approved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${item['method']} → $state'),
        content: TextField(
          controller: reason,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Operational reason'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (approved != true || reason.text.trim().length < 5) return;
    try {
      await AdminService().updatePayoutState(
        item['method'] as String,
        state,
        reason.text.trim(),
      );
      onChanged();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Provider update failed: $error')),
        );
      }
    }
  }
}

class _ControlsPage extends StatelessWidget {
  const _ControlsPage({required this.data, required this.onChanged});
  final AdminWorkspace data;
  final VoidCallback onChanged;
  @override
  Widget build(BuildContext context) {
    final ledger = (data.ledger['transactions'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>();
    final runs = (data.reconciliation['runs'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>();
    final reconciliationSummary =
        data.reconciliation['summary'] as Map<String, dynamic>? ?? const {};
    final activeConfig = data.configuration['active'] as Map<String, dynamic>?;
    final configValues =
        activeConfig?['values'] as Map<String, dynamic>? ?? const {};
    return _PageShell(
      title: 'Financial controls',
      subtitle:
          'Read-only ledger, reconciliation, and searchable audit evidence',
      children: [
        _SectionHeader(
          title: 'Fees and transaction limits',
          action: data.session.can('configuration.manage')
              ? FilledButton.tonalIcon(
                  onPressed: () => _configurationDialog(context, configValues),
                  icon: const Icon(Icons.tune),
                  label: const Text('New version'),
                )
              : const Text('Read only'),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 24,
              runSpacing: 12,
              children: [
                _ControlValue(
                  label: 'Config version',
                  value: '${activeConfig?['version'] ?? '—'}',
                ),
                _ControlValue(
                  label: 'TiCash fee',
                  value: '${configValues['ticashFeePercent'] ?? '—'}%',
                ),
                _ControlValue(
                  label: 'Minimum fee',
                  value: '\$${configValues['ticashMinimumFeeUsd'] ?? '—'}',
                ),
                _ControlValue(
                  label: 'Per transaction',
                  value: configValues['perTransactionUsd'] == null
                      ? 'Not configured'
                      : '\$${configValues['perTransactionUsd']}',
                ),
                _ControlValue(
                  label: 'Daily',
                  value: configValues['dailyUsd'] == null
                      ? 'Not configured'
                      : '\$${configValues['dailyUsd']}',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
        _SectionHeader(
          title: 'Reconciliation',
          action: data.session.can('reconciliation.run')
              ? FilledButton.tonalIcon(
                  onPressed: () async {
                    await AdminService().runReconciliation();
                    onChanged();
                  },
                  icon: const Icon(Icons.play_arrow),
                  label: const Text('Run'),
                )
              : const Text('Read only'),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 24,
              runSpacing: 12,
              children: [
                _ControlValue(
                  label: 'Matched',
                  value: '${reconciliationSummary['matchedTransactions'] ?? 0}',
                ),
                _ControlValue(
                  label: 'Unmatched events',
                  value:
                      '${reconciliationSummary['unmatchedProviderEvents'] ?? 0}',
                ),
                _ControlValue(
                  label: 'Amount mismatches',
                  value: '${reconciliationSummary['amountDiscrepancies'] ?? 0}',
                ),
                _ControlValue(
                  label: 'Duplicate attempts',
                  value:
                      '${reconciliationSummary['duplicateEventAttempts'] ?? 0}',
                ),
                _ControlValue(
                  label: 'Investigate',
                  value:
                      '${reconciliationSummary['transfersRequiringInvestigation'] ?? 0}',
                ),
              ],
            ),
          ),
        ),
        if (runs.isEmpty)
          const _EmptyCard(message: 'No reconciliation runs recorded.'),
        ...runs
            .take(8)
            .map(
              (run) => Card(
                child: ListTile(
                  leading: const Icon(Icons.rule_outlined),
                  title: Text(run['status'] as String),
                  subtitle: Text(
                    '${run['provider']} · ${run['discrepancyCount']} discrepancies',
                  ),
                ),
              ),
            ),
        const SizedBox(height: 20),
        const _SectionHeader(
          title: 'Immutable ledger',
          action: Chip(label: Text('READ ONLY')),
        ),
        if (ledger.isEmpty)
          const _EmptyCard(message: 'No persistent ledger entries available.'),
        ...ledger
            .take(15)
            .map(
              (transaction) => Card(
                child: ListTile(
                  leading: Icon(
                    transaction['balanced'] == true
                        ? Icons.balance
                        : Icons.warning_amber,
                    color: transaction['balanced'] == true
                        ? AppTheme.success
                        : AppTheme.error,
                  ),
                  title: Text(transaction['reference'] as String),
                  subtitle: Text(
                    '${transaction['type']} · ${(transaction['entries'] as List<dynamic>).length} entries',
                  ),
                  trailing: Text(
                    transaction['balanced'] == true
                        ? 'Balanced'
                        : 'Investigate',
                  ),
                ),
              ),
            ),
        const SizedBox(height: 20),
        const _SectionHeader(
          title: 'Recent audit history',
          action: Icon(Icons.lock_outline),
        ),
        ...data.overview.auditLogs
            .take(20)
            .map(
              (event) => ListTile(
                leading: const Icon(Icons.history),
                title: Text(event.action.replaceAll('_', ' ')),
                subtitle: Text(
                  '${event.entity}${event.entityId == null ? '' : ' · ${event.entityId}'}',
                ),
                trailing: Text(
                  '${event.createdAt.month}/${event.createdAt.day}',
                ),
              ),
            ),
      ],
    );
  }

  Future<void> _configurationDialog(
    BuildContext context,
    Map<String, dynamic> current,
  ) async {
    final fee = TextEditingController(
      text: '${current['ticashFeePercent'] ?? 0}',
    );
    final minimum = TextEditingController(
      text: '${current['ticashMinimumFeeUsd'] ?? 0}',
    );
    final provider = TextEditingController(
      text: '${current['providerFundingFeeUsd'] ?? 0}',
    );
    final per = TextEditingController(
      text: '${current['perTransactionUsd'] ?? ''}',
    );
    final daily = TextEditingController(text: '${current['dailyUsd'] ?? ''}');
    final weekly = TextEditingController(text: '${current['weeklyUsd'] ?? ''}');
    final monthly = TextEditingController(
      text: '${current['monthlyUsd'] ?? ''}',
    );
    final reason = TextEditingController();
    var enabled = current['limitsEnabled'] as bool? ?? false;
    final save = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Create fee & limit version'),
          content: SizedBox(
            width: 540,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  SwitchListTile(
                    title: const Text('Enforce transaction limits'),
                    value: enabled,
                    onChanged: (value) => setState(() => enabled = value),
                  ),
                  TextField(
                    controller: fee,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'TiCash fee percent',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: minimum,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Minimum TiCash fee (USD)',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: provider,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Provider/funding fee (USD)',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: per,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Per-transaction limit (USD)',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: daily,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Daily limit (USD)',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: weekly,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Weekly limit (USD)',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: monthly,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Monthly limit (USD)',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: reason,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Approval/change reason',
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Create version'),
            ),
          ],
        ),
      ),
    );
    if (save != true || reason.text.trim().length < 5) return;
    double? optional(String value) =>
        value.trim().isEmpty ? null : double.tryParse(value);
    try {
      await AdminService().updateFeeLimits({
        'ticashFeePercent': double.parse(fee.text),
        'ticashMinimumFeeUsd': double.parse(minimum.text),
        'providerFundingFeeUsd': double.parse(provider.text),
        'limitsEnabled': enabled,
        'perTransactionUsd': optional(per.text),
        'dailyUsd': optional(daily.text),
        'weeklyUsd': optional(weekly.text),
        'monthlyUsd': optional(monthly.text),
        'reason': reason.text.trim(),
      });
      onChanged();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Configuration update failed: $error')),
        );
      }
    }
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, required this.icon});
  final String label;
  final num value;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(icon, color: AppTheme.navy),
          Text(
            value.toStringAsFixed(0),
            style: Theme.of(
              context,
            ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          Text(
            label,
            maxLines: 2,
            style: const TextStyle(color: AppTheme.muted),
          ),
        ],
      ),
    ),
  );
}

class _SafetyBanner extends StatelessWidget {
  const _SafetyBanner();
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: AppTheme.navy,
      borderRadius: BorderRadius.circular(18),
    ),
    child: const Row(
      children: [
        Icon(Icons.shield_outlined, color: AppTheme.gold),
        SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'USD · CAD · EUR · MXN · BRL · CLP · DOP → Haiti (HTG)',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                'SANDBOX · APPROVED_FOR_LIVE_USE = false',
                style: TextStyle(color: Color(0xFFCBD5E1)),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _EnvironmentBadge extends StatelessWidget {
  const _EnvironmentBadge({required this.environment});
  final String environment;
  @override
  Widget build(BuildContext context) => Chip(
    avatar: const Icon(Icons.science_outlined, size: 17),
    label: Text(environment),
  );
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.action});
  final String title;
  final Widget action;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
        ),
        action,
      ],
    ),
  );
}

class _Detail extends StatelessWidget {
  const _Detail(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      children: [
        Expanded(
          child: Text(label, style: const TextStyle(color: AppTheme.muted)),
        ),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );
}

class _ControlValue extends StatelessWidget {
  const _ControlValue({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: 150,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: AppTheme.muted, fontSize: 12),
        ),
        const SizedBox(height: 3),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
      ],
    ),
  );
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Icon(icon, color: AppTheme.gold),
          const SizedBox(width: 12),
          Expanded(child: Text(text)),
        ],
      ),
    ),
  );
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Text(message, style: const TextStyle(color: AppTheme.muted)),
    ),
  );
}

class _NoPermission extends StatelessWidget {
  const _NoPermission({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.lock_outline, size: 52, color: AppTheme.muted),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
        ],
      ),
    ),
  );
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.error, required this.retry});
  final Object error;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 54),
          const SizedBox(height: 12),
          Text('Admin data unavailable\n$error', textAlign: TextAlign.center),
          const SizedBox(height: 16),
          FilledButton.tonal(onPressed: retry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}
