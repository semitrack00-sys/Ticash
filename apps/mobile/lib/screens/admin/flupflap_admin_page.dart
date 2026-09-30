import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../services/api_client.dart';
import '../../services/admin_service.dart';
import '../../services/admin_analytics_service.dart';
import '../../widgets/admin_analytics_panel.dart';

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
    ('Products', 'products', 'recharge.providers.view'),
    ('Providers', 'providers', 'recharge.providers.view'),
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
    if (!widget.session.can('recharge.view')) return;
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
                      'Global airtime, data, bundles and provider operations',
                      style: TextStyle(color: Color(0xFFDDE7FF)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 8,
          children: [
            for (final s in sections)
              if (widget.session.can(s.$3))
                ChoiceChip(
                  label: Text(s.$1),
                  selectedColor: const Color(0xFFDDE7FF),
                  backgroundColor: const Color(0xFFF8FAFC),
                  side: const BorderSide(color: Color(0xFFE2E8F0)),
                  labelStyle: TextStyle(
                    color: section == s.$2 ? const Color(0xFF1D4ED8) : AppTheme.ink,
                    fontWeight: section == s.$2 ? FontWeight.w800 : FontWeight.w600,
                  ),
                  selected: section == s.$2,
                  onSelected: (_) => setState(() {
                    section = s.$2;
                    offset = 0;
                    if (!['operators', 'products'].contains(section)) {
                      load();
                    } else {
                      result = null;
                    }
                  }),
                ),
          ],
        ),
        if (['operators', 'products'].contains(section))
          Wrap(
            spacing: 8,
            children: [
              SizedBox(
                width: 160,
                child: TextField(
                  controller: country,
                  decoration: const InputDecoration(
                    labelText: 'Country ISO code',
                  ),
                ),
              ),
              if (section == 'products')
                SizedBox(
                  width: 180,
                  child: TextField(
                    controller: operatorId,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Operator ID'),
                  ),
                ),
              TextButton(
                onPressed: () => setState(load),
                child: const Text('Load provider catalog'),
              ),
            ],
          ),
        const SizedBox(height: 16),
        if (result != null)
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
