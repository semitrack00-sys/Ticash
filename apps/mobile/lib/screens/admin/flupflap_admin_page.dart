import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../../services/api_client.dart';
import '../../services/admin_service.dart';

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
        Text(
          'FlupFlap Recharge',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const Text(
          'Separate FlupFlap customers · shared recharge engine · sandbox controls',
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 8,
          children: [
            for (final s in sections)
              if (widget.session.can(s.$3))
                ChoiceChip(
                  label: Text(s.$1),
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
