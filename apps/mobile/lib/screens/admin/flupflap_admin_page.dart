import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../services/api_client.dart';
import '../../services/admin_service.dart';
import '../../services/admin_analytics_service.dart';
import '../../widgets/admin_analytics_panel.dart';
import '../../widgets/flupflap_promotions_panel.dart';

/// A section of the existing Operations workspace, authenticated as TiCash staff.
class FlupFlapAdminPage extends StatefulWidget {
  const FlupFlapAdminPage({super.key, required this.session, this.dio});
  final AdminSession session;
  final Dio? dio;
  @override
  State<FlupFlapAdminPage> createState() => _FlupFlapAdminPageState();
}

class _FlupFlapAdminPageState extends State<FlupFlapAdminPage> {
  static const sections = [
    ('Dashboard', 'dashboard', 'recharge.view'),
    ('Transactions', 'transactions', 'recharge.transactions.view'),
    ('FlupFlap Customers', 'customers', 'recharge.customers.view'),
    ('Countries', 'countries', 'recharge.providers.view'),
    ('Operators', 'operators', 'recharge.providers.view'),
    ('Internet Plans', 'products', 'recharge.providers.view'),
    ('Providers', 'providers', 'recharge.providers.view'),
    ('Promotions / Influencers', 'promotions', 'recharge.configuration.view'),
    ('Pending / Failures', 'pending-failures', 'recharge.transactions.view'),
    ('Refunds', 'refunds', 'recharge.refunds'),
    ('Financials', 'financials', 'recharge.reports'),
    ('Reports', 'reports', 'recharge.reports'),
    ('Settings', 'settings', 'recharge.configuration.view'),
    ('Audit', 'audit', 'audit.view'),
  ];
  Dio get client => widget.dio ?? ApiClient.instance.dio;
  String section = 'dashboard';
  int offset = 0;
  Future<Map<String, dynamic>>? result;
  final country = TextEditingController(), operatorId = TextEditingController();
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    country.dispose();
    operatorId.dispose();
    super.dispose();
  }

  void load() {
    if (!widget.session.can('recharge.view') || section == 'promotions') return;
    final query = <String, dynamic>{'offset': offset};
    if (['operators', 'products'].contains(section)) {
      query['country'] = country.text.trim().toUpperCase();
    }
    if (section == 'products') query['operator'] = operatorId.text.trim();
    result = client
        .get('/admin/flupflap/$section', queryParameters: query)
        .then((r) => Map<String, dynamic>.from(r.data as Map));
  }

  Future<void> operate(Map row) async {
    String? reason;
    if (section == 'customers') {
      final input = TextEditingController();
      reason = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Recharge restriction'),
          content: TextField(
            controller: input,
            decoration: const InputDecoration(labelText: 'Reason (required)'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, input.text.trim()),
              child: const Text('Confirm'),
            ),
          ],
        ),
      );
      input.dispose();
      if (reason == null || reason.length < 5) return;
    }
    try {
      if (section == 'customers') {
        await client.patch(
          '/admin/flupflap/customers/${row['id']}/restrictions',
          data: {
            'rechargeRestricted': row['rechargeRestricted'] != true,
            'reason': reason,
          },
        );
      } else {
        await client.post(
          '/admin/flupflap/transactions/${row['id']}/reconcile',
          data: <String, dynamic>{},
        );
      }
      if (mounted) setState(load);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Operation could not be completed. No success was assumed.',
            ),
          ),
        );
      }
    }
  }

  Future<void> retryNotification(Map row) async {
    try {
      await client.post(
        '/admin/flupflap/transactions/${row['id']}/receiver-notification/retry',
        data: <String, dynamic>{},
      );
      if (mounted) setState(load);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Notification retry unavailable. Recharge status is unchanged.',
            ),
          ),
        );
      }
    }
  }

  String value(dynamic input) {
    if (input == null) return '—';
    if (input is List) return input.map(value).join(', ');
    if (input is Map) {
      return input.entries
          .map((e) => '${e.key}: ${value(e.value)}')
          .join(' · ');
    }
    return '$input';
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.session.can('recharge.view')) {
      return const Center(
        child: Text('Your staff role cannot access FlupFlap Recharge.'),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF0F172A), Color(0xFF1D4ED8), Color(0xFF7C3AED)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          child: const Row(
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: Color(0x22FFFFFF),
                child: Icon(Icons.bolt_rounded, color: Colors.white, size: 28),
              ),
              SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'FlupFlap Recharge',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Global airtime, internet plans, bundles and provider operations',
                      style: TextStyle(color: Color(0xFFDDE7FF)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _FlupFlapAdminNavigation(
          sections: sections,
          current: section,
          canAccess: widget.session.can,
          onSelect: (next) => setState(() {
            section = next;
            offset = 0;
            if (!['operators', 'products'].contains(section)) {
              load();
            } else {
              result = null;
            }
          }),
        ),
        const SizedBox(height: 16),
        _AdminSectionHeader(section: section),
        if (['operators', 'products'].contains(section)) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.border),
            ),
            child: Wrap(
              spacing: 12,
              runSpacing: 12,
              crossAxisAlignment: WrapCrossAlignment.end,
              children: [
                SizedBox(
                  width: 180,
                  child: TextField(
                    controller: country,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Country ISO code',
                      hintText: 'US, HT, CA…',
                      prefixIcon: Icon(Icons.public_outlined),
                    ),
                  ),
                ),
                if (section == 'products')
                  SizedBox(
                    width: 200,
                    child: TextField(
                      controller: operatorId,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Operator ID',
                        prefixIcon: Icon(Icons.cell_tower_outlined),
                      ),
                    ),
                  ),
                FilledButton.icon(
                  onPressed: () => setState(load),
                  icon: const Icon(Icons.search),
                  label: Text(
                    section == 'products'
                        ? 'Load internet plans'
                        : 'Load operators',
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        if (section == 'promotions')
          FlupFlapPromotionsPanel(
            dio: client,
            canManage: widget.session.can('recharge.configuration.manage'),
          ),
        if (result != null && section != 'promotions')
          FutureBuilder<Map<String, dynamic>>(
            future: result,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return TextButton(
                  onPressed: () => setState(load),
                  child: const Text('Unable to load authorized records. Retry'),
                );
              }
              final data = snapshot.data!;
              final rows =
                  data['transactions'] ??
                  data['customers'] ??
                  data['countries'] ??
                  data['operators'] ??
                  data['products'] ??
                  data['events'];
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (section == 'dashboard' && widget.session.can('recharge.reports')) ...[
                    AdminAnalyticsPanel(business: AnalyticsBusiness.flupflap, dio: widget.dio),
                    const SizedBox(height: 18),
                  ],
                  if (section == 'dashboard')
                    _FlupFlapStatusDiagram(data: data),
                  if (section == 'dashboard') const SizedBox(height: 18),
                  if (data['scope'] == 'PAGE')
                    const Text(
                      'Values below cover this page only; these are not lifetime financial totals.',
                    ),
                  if (['settings', 'refunds'].contains(section))
                    const Text(
                      'Live configuration and manual refund changes require the reviewed provider workflow. This screen never marks a payment refunded.',
                    ),
                  if (section == 'products' && rows is List) ...[
                    _ProductCatalogSummary(rows: rows.cast<Map>()),
                    const SizedBox(height: 12),
                  ],
                  if (rows is List) ...[
                    if (rows.isEmpty) const Text('No records.'),
                    for (final row in rows)
                      Card(
                        color: _sectionTint(section),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              for (final e in (row as Map).entries)
                                SelectableText('${e.key}: ${value(e.value)}'),
                              if (section == 'transactions' &&
                                  row['status'] == 'DELIVERED' &&
                                  widget.session.can('recharge.operations') &&
                                  row['notification'] is Map &&
                                  [
                                    'SMS_NOT_CONFIGURED',
                                    'PROVIDER_REJECTED',
                                  ].contains(
                                    row['notification']['lastErrorCategory'],
                                  ))
                                TextButton(
                                  onPressed: () => retryNotification(row),
                                  child: const Text('Retry receiver SMS'),
                                ),
                              if (section == 'customers' &&
                                  widget.session.can('recharge.operations'))
                                TextButton(
                                  onPressed: () => operate(row),
                                  child: Text(
                                    row['rechargeRestricted'] == true
                                        ? 'Remove recharge restriction'
                                        : 'Restrict recharge',
                                  ),
                                ),
                              if ([
                                    'transactions',
                                    'pending-failures',
                                  ].contains(section) &&
                                  widget.session.can('recharge.reconciliation'))
                                TextButton(
                                  onPressed: () => operate(row),
                                  child: const Text(
                                    'Refresh provider-confirmed status',
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                  ] else
                    for (final e in data.entries)
                      ListTile(
                        title: Text(e.key),
                        subtitle: Text(value(e.value)),
                      ),
                  if (data.containsKey('nextOffset'))
                    Row(
                      children: [
                        TextButton(
                          onPressed: offset == 0
                              ? null
                              : () => setState(() {
                                  offset = (offset - 100).clamp(0, 100000);
                                  load();
                                }),
                          child: const Text('Previous'),
                        ),
                        TextButton(
                          onPressed: data['nextOffset'] == null
                              ? null
                              : () => setState(() {
                                  offset = data['nextOffset'] as int;
                                  load();
                                }),
                          child: const Text('Next'),
                        ),
                      ],
                    ),
                ],
              );
            },
          ),
      ],
    );
  }
}



class _FlupFlapAdminNavigation extends StatelessWidget {
  const _FlupFlapAdminNavigation({
    required this.sections,
    required this.current,
    required this.canAccess,
    required this.onSelect,
  });

  final List<(String, String, String)> sections;
  final String current;
  final bool Function(String) canAccess;
  final ValueChanged<String> onSelect;

  static const groups = <(String, IconData, List<String>)>[
    ('Overview', Icons.dashboard_outlined, ['dashboard']),
    (
      'Customers & Activity',
      Icons.people_alt_outlined,
      ['transactions', 'customers', 'pending-failures']
    ),
    (
      'Catalog & Network',
      Icons.hub_outlined,
      ['countries', 'operators', 'products', 'providers']
    ),
    ('Growth', Icons.campaign_outlined, ['promotions']),
    (
      'Finance & Governance',
      Icons.account_balance_outlined,
      ['refunds', 'financials', 'reports', 'settings', 'audit']
    ),
  ];

  IconData _icon(String key) => switch (key) {
    'dashboard' => Icons.space_dashboard_outlined,
    'transactions' => Icons.receipt_long_outlined,
    'customers' => Icons.people_outline,
    'countries' => Icons.public_outlined,
    'operators' => Icons.cell_tower_outlined,
    'products' => Icons.data_usage_outlined,
    'providers' => Icons.route_outlined,
    'promotions' => Icons.campaign_outlined,
    'pending-failures' => Icons.warning_amber_rounded,
    'refunds' => Icons.currency_exchange_outlined,
    'financials' => Icons.account_balance_wallet_outlined,
    'reports' => Icons.bar_chart_outlined,
    'settings' => Icons.tune_outlined,
    'audit' => Icons.fact_check_outlined,
    _ => Icons.circle_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final byKey = {for (final item in sections) item.$2: item};
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x080F172A),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'ADMIN WORKSPACE',
            style: TextStyle(
              color: AppTheme.muted,
              fontSize: 11,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 14),
          for (final group in groups) ...[
            if (group.$3.any((key) {
              final item = byKey[key];
              return item != null && canAccess(item.$3);
            })) ...[
              Row(
                children: [
                  Icon(group.$2, size: 17, color: const Color(0xFF64748B)),
                  const SizedBox(width: 7),
                  Text(
                    group.$1,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF475569),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final key in group.$3)
                    if (byKey[key] case final item?)
                      if (canAccess(item.$3))
                        ChoiceChip(
                          avatar: Icon(
                            _icon(key),
                            size: 17,
                            color: current == key
                                ? const Color(0xFF1D4ED8)
                                : const Color(0xFF64748B),
                          ),
                          label: Text(item.$1),
                          selected: current == key,
                          selectedColor: const Color(0xFFE8F0FF),
                          backgroundColor: const Color(0xFFF8FAFC),
                          side: BorderSide(
                            color: current == key
                                ? const Color(0xFFBFDBFE)
                                : const Color(0xFFE2E8F0),
                          ),
                          labelStyle: TextStyle(
                            color: current == key
                                ? const Color(0xFF1D4ED8)
                                : AppTheme.ink,
                            fontWeight: current == key
                                ? FontWeight.w800
                                : FontWeight.w600,
                          ),
                          onSelected: (_) => onSelect(key),
                        ),
                ],
              ),
              const SizedBox(height: 14),
            ],
          ],
        ],
      ),
    );
  }
}

class _AdminSectionHeader extends StatelessWidget {
  const _AdminSectionHeader({required this.section});
  final String section;

  (String, String, IconData) get details => switch (section) {
    'dashboard' => (
      'Dashboard',
      'Service health, readiness, volume and business performance.',
      Icons.space_dashboard_outlined
    ),
    'transactions' => (
      'Transactions',
      'Review recharge lifecycle, payment state and delivery records.',
      Icons.receipt_long_outlined
    ),
    'customers' => (
      'FlupFlap Customers',
      'Customer access, recharge restrictions and account operations.',
      Icons.people_outline
    ),
    'countries' => (
      'Countries',
      'Review provider-backed country coverage currently exposed to FlupFlap.',
      Icons.public_outlined
    ),
    'operators' => (
      'Operators',
      'Inspect mobile operators by destination country.',
      Icons.cell_tower_outlined
    ),
    'products' => (
      'Internet Plans',
      'Inspect provider-backed airtime, data and bundle products.',
      Icons.data_usage_outlined
    ),
    'providers' => (
      'Providers',
      'Review configured recharge providers and coverage state.',
      Icons.route_outlined
    ),
    'promotions' => (
      'Promotions & Influencers',
      'Create campaigns, manage promoters and review attributed performance.',
      Icons.campaign_outlined
    ),
    'pending-failures' => (
      'Pending & Failures',
      'Focus on transactions that need operational review or reconciliation.',
      Icons.warning_amber_rounded
    ),
    'refunds' => (
      'Refunds',
      'Review refund-related records without overriding provider-confirmed state.',
      Icons.currency_exchange_outlined
    ),
    'financials' => (
      'Financials',
      'Review authorized financial reporting for recharge activity.',
      Icons.account_balance_wallet_outlined
    ),
    'reports' => (
      'Reports',
      'Review operational and business reporting for FlupFlap.',
      Icons.bar_chart_outlined
    ),
    'settings' => (
      'Settings',
      'Review configuration state and protected operational controls.',
      Icons.tune_outlined
    ),
    'audit' => (
      'Audit',
      'Review staff and system events for accountability and traceability.',
      Icons.fact_check_outlined
    ),
    _ => ('FlupFlap Admin', 'Authorized recharge operations.', Icons.bolt_outlined),
  };

  @override
  Widget build(BuildContext context) {
    final d = details;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: const Color(0xFFE8F0FF),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(d.$3, color: const Color(0xFF1D4ED8)),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  d.$1,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    color: AppTheme.ink,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  d.$2,
                  style: const TextStyle(
                    color: AppTheme.muted,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProductCatalogSummary extends StatelessWidget {
  const _ProductCatalogSummary({required this.rows});
  final List<Map> rows;

  String _text(Map row) => [
    row['type'], row['kind'], row['productType'], row['name'], row['description'],
  ].whereType<Object>().join(' ').toUpperCase();

  @override
  Widget build(BuildContext context) {
    final internetPlans = rows.where((row) {
      final text = _text(row);
      return text.contains('DATA') || text.contains('INTERNET') || text.contains('BUNDLE');
    }).length;
    final airtime = rows.length - internetPlans;
    return Container(
      key: const Key('flupflap-product-catalog-summary'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Wrap(
        spacing: 24,
        runSpacing: 8,
        children: [
          Text('Internet Plans: $internetPlans', style: const TextStyle(fontWeight: FontWeight.w900)),
          Text('Airtime: $airtime', style: const TextStyle(fontWeight: FontWeight.w800)),
          Text('Provider products: ${rows.length}', style: const TextStyle(color: AppTheme.muted)),
        ],
      ),
    );
  }
}

Color _sectionTint(String section) => switch (section) {
  'transactions' => const Color(0xFFF8FAFC),
  'customers' => const Color(0xFFF5F3FF),
  'countries' || 'operators' || 'products' || 'providers' => const Color(0xFFEFF6FF),
  'pending-failures' => const Color(0xFFFFF7ED),
  'refunds' => const Color(0xFFFFF1F2),
  'financials' || 'reports' => const Color(0xFFECFDF5),
  'settings' => const Color(0xFFF8FAFC),
  'audit' => const Color(0xFFF5F3FF),
  _ => Colors.white,
};

class _FlupFlapStatusDiagram extends StatelessWidget {
  const _FlupFlapStatusDiagram({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final rows = <(String, bool, Color, IconData)>[
      (
        'Recharge service',
        data['enabled'] == true,
        const Color(0xFF2563EB),
        Icons.power_settings_new,
      ),
      (
        'Production enabled',
        data['productionEnabled'] == true,
        const Color(0xFF7C3AED),
        Icons.public,
      ),
      (
        'Approved for live use',
        data['approvedForLiveUse'] == true,
        const Color(0xFF059669),
        Icons.verified_user_outlined,
      ),
      (
        'Live recharge',
        data['liveRechargeEnabled'] == true,
        const Color(0xFF16A34A),
        Icons.bolt,
      ),
      (
        'Recurring recharge',
        data['recurringRechargeEnabled'] == true,
        const Color(0xFFF59E0B),
        Icons.autorenew,
      ),
    ];

    final enabledCount = rows.where((row) => row.$2).length;
    final readiness = enabledCount / rows.length;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D0F172A),
            blurRadius: 22,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Platform readiness diagram',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 4),
          Text(
            '${data['providerMode'] ?? 'UNKNOWN'} provider mode · ${data['environment'] ?? 'UNKNOWN'} · ${data['paymentMode'] ?? 'UNKNOWN'}',
            style: const TextStyle(color: AppTheme.muted),
          ),
          const SizedBox(height: 18),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              minHeight: 12,
              value: readiness,
              backgroundColor: const Color(0xFFE2E8F0),
              valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF2563EB)),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '$enabledCount of ${rows.length} operational gates enabled',
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 18),
          LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth;
              final columns = width > 850 ? 5 : width > 520 ? 3 : 2;
              final itemWidth = (width - ((columns - 1) * 10)) / columns;
              return Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final row in rows)
                    SizedBox(
                      width: itemWidth,
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: row.$3.withValues(alpha: .08),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: row.$3.withValues(alpha: .20)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(row.$4, color: row.$3),
                            const SizedBox(height: 12),
                            Text(
                              row.$1,
                              style: const TextStyle(fontWeight: FontWeight.w800),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              row.$2 ? 'Enabled' : 'Not enabled',
                              style: TextStyle(
                                color: row.$2 ? const Color(0xFF059669) : AppTheme.muted,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}
