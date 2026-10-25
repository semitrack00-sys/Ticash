import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../services/admin_analytics_service.dart';

const _ink = Color(0xFF142449);
const _muted = Color(0xFF64748B);

String adminDate(dynamic value) {
  if (value == null || value.toString().isEmpty) return 'Not recorded';
  var raw = value.toString();
  if (!raw.endsWith('Z') && !RegExp(r'[+-]\d\d:\d\d$').hasMatch(raw)) raw += 'Z';
  final date = DateTime.tryParse(raw)?.toUtc();
  if (date == null) return 'Not recorded';
  return '${date.toIso8601String().substring(0, 10)} · ${date.toIso8601String().substring(11, 16)} UTC';
}

String adminClientName(Map row) {
  final name = [row['firstName'], row['lastName']].where((v) => v != null && v.toString().trim().isNotEmpty).join(' ');
  return name.isNotEmpty ? name : row['guest'] == true ? 'Guest account' : 'Name not provided';
}

class AdminInsightPage extends StatelessWidget {
  const AdminInsightPage({super.key, required this.dio, required this.title, required this.value,
    required this.query, this.onResetCustomer, this.onRestrictCustomer});
  final Dio dio;
  final String title, value;
  final Map<String, dynamic> query;
  final Future<void> Function(Map)? onResetCustomer, onRestrictCustomer;
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F7FB),
    appBar: AppBar(title: Text(title), backgroundColor: Colors.white, foregroundColor: _ink),
    body: SingleChildScrollView(padding: const EdgeInsets.all(20), child: Center(child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 1100),
      child: FlupFlapRecordExplorer(dio: dio, title: title, value: value, query: query, onResetCustomer: onResetCustomer, onRestrictCustomer: onRestrictCustomer),
    ))),
  );
}

/// The same directory powers dashboard drill-down and the Customers section.
class FlupFlapRecordExplorer extends StatefulWidget {
  const FlupFlapRecordExplorer({super.key, required this.dio, required this.title,
    this.value, this.query = const {}, this.directory = false, this.onResetCustomer, this.onRestrictCustomer});
  final Dio dio;
  final String title;
  final String? value;
  final Map<String, dynamic> query;
  final bool directory;
  final Future<void> Function(Map)? onResetCustomer, onRestrictCustomer;
  @override
  State<FlupFlapRecordExplorer> createState() => _FlupFlapRecordExplorerState();
}

class _FlupFlapRecordExplorerState extends State<FlupFlapRecordExplorer> {
  final search = TextEditingController();
  int offset = 0;
  String? country;
  Timer? searchDelay;
  late Future<Map<String, dynamic>> result;
  @override
  void initState() { super.initState(); country = widget.query['country'] as String?; load(); }
  @override
  void dispose() { searchDelay?.cancel(); search.dispose(); super.dispose(); }
  void load() {
    final query = {...widget.query, 'offset': offset, 'q': search.text.trim()}..remove('country');
    if (country != null) query['country'] = country;
    result = AdminAnalyticsService(dio: widget.dio).details(
      directory: widget.directory,
      query: query,
    );
    result.ignore();
  }
  Future<void> operate(Map row, Future<void> Function(Map) action) async {
    await action(row);
    if (mounted) setState(load);
  }
  void filter() { searchDelay?.cancel(); setState(() { offset = 0; load(); }); }
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Container(padding: const EdgeInsets.all(20), decoration: _decoration(), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(widget.title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: _ink)),
      const SizedBox(height: 6),
      Text(widget.directory ? 'Client directory · registration dates, account details and purchase controls'
        : _explanation(widget.query['metric'].toString()), style: const TextStyle(color: _muted)),
      if (widget.query['asOf'] != null) Text('Records created before ${adminDate(widget.query['asOf'])}', style: const TextStyle(fontSize: 12, color: _muted)),
    ])),
    const SizedBox(height: 16),
    TextField(controller: search, textInputAction: TextInputAction.search, onSubmitted: (_) => filter(),
      onChanged: (_) { searchDelay?.cancel(); searchDelay = Timer(const Duration(milliseconds: 400), filter); },
      decoration: InputDecoration(labelText: widget.directory || widget.query['metric'].toString().startsWith('clients.') ? 'Search clients' : 'Search transactions',
        hintText: 'Name, phone number or email', prefixIcon: const Icon(Icons.search),
        suffixIcon: IconButton(tooltip: 'Search records', onPressed: filter, icon: const Icon(Icons.arrow_forward)), border: const OutlineInputBorder())),
    const SizedBox(height: 12),
    FutureBuilder<Map<String, dynamic>>(future: result, builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) return const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()));
      if (snapshot.hasError) {
        return Column(children: [
        const Text('Details are unavailable for this staff account. Refresh or check your viewing permissions.'),
        TextButton(onPressed: () => setState(load), child: const Text('Retry details')),
        ]);
      }
      final data = snapshot.data!;
      final rows = (data['rows'] as List).cast<Map<String, dynamic>>();
      final countries = (data['countries'] as List).cast<Map<String, dynamic>>();
      final clients = data['kind'] == 'CLIENTS';
      final metric = widget.query['metric'];
      final metricValue = const ['volume', 'fees', 'average'].contains(metric) ? analyticsMoney(data['metricValue'])
        : metric == 'successRate' ? data['metricValue'] == null ? '—' : '${data['metricValue']}%'
        : '${data['metricValue'] ?? data['total']}';
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(metricValue, style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: _ink)),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: country ?? 'ALL', isExpanded: true,
          decoration: InputDecoration(labelText: clients ? 'Client profile country' : 'Recharge destination', border: const OutlineInputBorder()),
          items: [DropdownMenuItem(value: 'ALL', child: Text('All countries · ${data['overallTotal']} ${clients ? 'clients' : 'transactions'}')),
            for (final c in countries) DropdownMenuItem(value: c['code'].toString(), child: Text('${c['name']} · ${c['total']}', overflow: TextOverflow.ellipsis))],
          onChanged: (value) { country = value == 'ALL' ? null : value; filter(); }),
        const SizedBox(height: 12),
        Text('${data['total']} matching ${clients ? 'clients' : 'transactions'} · ${data['mode'] == 'test' ? 'Test activity' : 'Live activity'}',
          style: const TextStyle(fontWeight: FontWeight.w700, color: _ink)),
        if (clients) const Text('Country comes from the client profile. Not provided includes accounts without a saved country.', style: TextStyle(fontSize: 12, color: _muted)),
        const SizedBox(height: 12),
        if (rows.isEmpty) const Padding(padding: EdgeInsets.all(28), child: Text('No records match these filters.')),
        for (final row in rows) Padding(padding: const EdgeInsets.only(bottom: 12), child: Material(
          color: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Color(0xFFE2E8F0))),
          clipBehavior: Clip.antiAlias,
          child: InkWell(onTap: () => _showRecord(context, row, clients,
            widget.onResetCustomer == null ? null : (row) => operate(row, widget.onResetCustomer!),
            widget.onRestrictCustomer == null ? null : (row) => operate(row, widget.onRestrictCustomer!)),
            child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                CircleAvatar(backgroundColor: const Color(0xFFF0F4FA), foregroundColor: _ink,
                  child: Icon(clients ? Icons.person_outline : Icons.receipt_long_outlined)),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(clients ? adminClientName(row) : '${row['product'] ?? 'Recharge'}', style: const TextStyle(fontWeight: FontWeight.w800, color: _ink)),
                  Text(clients ? '${row['email'] ?? 'Email not provided'}' : '${row['operator']} · ${row['countryCode']}', style: const TextStyle(color: _muted)),
                  Text('${clients ? row['guest'] == true ? 'Account created' : 'Registered on' : 'Created'} ${adminDate(row['createdAt'])}', style: const TextStyle(fontSize: 12, color: _muted)),
                ])),
                const Icon(Icons.chevron_right, color: _muted),
              ]),
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 6, children: [
                _badge(clients ? row['guest'] == true ? 'Guest' : 'Registered' : '${row['status']}'),
                _badge(clients ? row['countryCode'] == 'UNKNOWN' ? 'Country not provided' : '${row['countryCode']}' : analyticsMoney(row['totalCents'])),
                if (clients && row['rechargeRestricted'] == true) _badge('Recharge restricted'),
              ]),
              if (clients && widget.onResetCustomer != null && row['guest'] != true && row['status'] == 'ACTIVE' && row['rechargeRestricted'] != true) Align(alignment: Alignment.centerLeft, child: TextButton.icon(
                onPressed: () => operate(row, widget.onResetCustomer!), icon: const Icon(Icons.restart_alt, size: 18),
                label: const Text('Reset purchase-attempt limit'))),
              if (clients && widget.onRestrictCustomer != null) Align(alignment: Alignment.centerLeft, child: TextButton.icon(
                onPressed: () => operate(row, widget.onRestrictCustomer!), icon: const Icon(Icons.shield_outlined, size: 18),
                label: Text(row['rechargeRestricted'] == true ? 'Remove recharge restriction' : 'Restrict recharge'))),
            ])),
          ),
        )),
        const SizedBox(height: 8),
        Row(children: [
          TextButton(onPressed: offset == 0 ? null : () => setState(() { offset -= 25; load(); }), child: const Text('Previous')),
          Expanded(child: Text(rows.isEmpty ? '0 records' : '${offset + 1}–${offset + rows.length} of ${data['total']}', textAlign: TextAlign.center)),
          TextButton(onPressed: data['nextOffset'] == null ? null : () => setState(() { offset = data['nextOffset'] as int; load(); }), child: const Text('Next')),
        ]),
      ]);
    }),
  ]);
}

String _explanation(String metric) => switch (metric) {
  'clients.total' => 'All client accounts created before the displayed snapshot, including historical guests.',
  'clients.active' => 'Clients with at least one transaction in the selected period.',
  'clients.new' => 'Clients who joined during the selected period.',
  'clients.today' || 'clients.week' || 'clients.month' || 'clients.year' => 'Registrations in the indicated UTC calendar period, up to this snapshot.',
  'clients.guest' => 'Historical guest accounts. New guest purchases remain disabled.',
  'clients.registered' => 'Permanent registered client accounts.',
  'volume' => 'Completed recharge sales. The total is the sum of recharge amounts; fees are shown separately.',
  'fees' => 'Recorded fees from completed recharges. These are fee receipts, not net profit.',
  'average' => 'Completed recharge amount divided by the number of completed transactions. Contributing transactions are listed below.',
  'successRate' => 'Successful transactions divided by all transactions in the selected period. All outcomes are listed below.',
  _ => 'Transactions matching this status in the selected period. Tap a record for payment, delivery and client details.',
};

BoxDecoration _decoration() => BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFE2E8F0)));
Widget _badge(String label) => Container(padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
  decoration: BoxDecoration(color: const Color(0xFFF0F4FA), borderRadius: BorderRadius.circular(6)),
  child: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _ink)));

void _showRecord(BuildContext context, Map<String, dynamic> row, bool client, Future<void> Function(Map)? reset, Future<void> Function(Map)? restrict) {
  showDialog<void>(context: context, builder: (context) => Dialog(child: ConstrainedBox(
    constraints: const BoxConstraints(maxWidth: 680),
    child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [Expanded(child: Text(client ? 'Client profile' : 'Transaction details', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: _ink))),
        IconButton(tooltip: 'Close details', onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close))]),
      const SizedBox(height: 16),
      if (client) ..._profile(row) else ...[
        _section('Recharge'),
        _fact('Reference', row['id']), _fact('Created', adminDate(row['createdAt'])), _fact('Product', row['product']),
        _fact('Operator', row['operator']), _fact('Destination country', row['countryCode']), _fact('Recipient', row['recipientPhone']),
        _section('Payment'), _fact('Status', row['paymentStatus']), _fact('Payment provider', row['paymentProvider']),
        _fact('Recharge amount', analyticsMoney(row['amountCents'])), _fact('Fee', analyticsMoney(row['feeCents'])), _fact('Total charged', analyticsMoney(row['totalCents'])),
        _section('Delivery & recovery'), _fact('Delivery status', row['status']), _fact('Supplier', row['provider']),
        _fact('Receiver value', row['deliveredValue'] == null ? null : '${row['deliveredValue']} ${row['deliveredCurrency']}'),
        _fact('Delivered', adminDate(row['deliveredAt'])), _fact('Failed', adminDate(row['failedAt'])), _fact('Refunded', adminDate(row['refundedAt'])),
        _fact('Failure reason', row['failureCode']), _fact('Recovery / review reason', row['paymentRecoveryCode']),
        if (row['customer'] is Map) ...[_section('Client'), ..._profile(Map<String, dynamic>.from(row['customer'] as Map))]
        else const Text('Client contact details require customer-view permission.', style: TextStyle(color: _muted)),
      ],
      if (client && reset != null && row['guest'] != true && row['status'] == 'ACTIVE' && row['rechargeRestricted'] != true) Padding(padding: const EdgeInsets.only(top: 16), child: OutlinedButton.icon(
        onPressed: () { Navigator.pop(context); reset(row); }, icon: const Icon(Icons.restart_alt), label: const Text('Reset purchase-attempt limit'))),
      if (client && restrict != null) OutlinedButton.icon(onPressed: () { Navigator.pop(context); restrict(row); },
        icon: const Icon(Icons.shield_outlined), label: Text(row['rechargeRestricted'] == true ? 'Remove recharge restriction' : 'Restrict recharge')),
    ])),
  )));
}

List<Widget> _profile(Map<String, dynamic> row) => [
  Text(adminClientName(row), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: _ink)),
  _section('Contact'), _fact('Email', row['email']), _fact('Phone', row['phone']), _fact('Profile country', row['countryCode'] == 'UNKNOWN' ? 'Not provided' : row['countryCode']),
  _section('Account'), _fact('Client ID', row['id']), _fact('Account type', row['guest'] == true ? 'Guest' : 'Registered'),
  _fact(row['guest'] == true ? 'Account created' : 'Registered on', adminDate(row['createdAt'])), _fact('Last sign-in', adminDate(row['lastLoginAt'])),
  _fact('Status', row['status']), _fact('Recharge access', row['rechargeRestricted'] == true ? 'Restricted' : 'Available subject to purchase limits'),
  _fact('Email verified (optional)', row['emailVerified'] == true ? 'Yes' : 'No'), _fact('Phone verified', row['phoneVerified'] == true ? 'Yes' : 'No'),
  if (row.containsKey('transactionCount')) ...[_section('Activity through this snapshot'), _fact('Transactions', row['transactionCount']),
    _fact('Completed', row['successfulCount']), _fact('Total completed spend including fees', analyticsMoney(row['spentCents']))],
];
Widget _section(String title) => Padding(padding: const EdgeInsets.only(top: 20, bottom: 8), child: Text(title.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1, color: _muted)));
Widget _fact(String label, dynamic value) => Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: LayoutBuilder(builder: (context, constraints) {
  final text = value == null || value.toString().isEmpty ? 'Not provided' : value.toString();
  if (constraints.maxWidth < 420) return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(fontSize: 12, color: _muted)), SelectableText(text, style: const TextStyle(color: _ink))]);
  return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 185, child: Text(label, style: const TextStyle(color: _muted))), Expanded(child: SelectableText(text, style: const TextStyle(color: _ink)))]);
}));
