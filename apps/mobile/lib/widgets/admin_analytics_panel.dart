import 'dart:math' as math;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../services/admin_analytics_service.dart';

/// Shared presentation only. Each business has an independent, authorized API.
class AdminAnalyticsPanel extends StatefulWidget {
  const AdminAnalyticsPanel({super.key, required this.business, this.dio});
  final AnalyticsBusiness business;
  final Dio? dio;
  @override
  State<AdminAnalyticsPanel> createState() => _AdminAnalyticsPanelState();
}

class _AdminAnalyticsPanelState extends State<AdminAnalyticsPanel> {
  String period = '30d';
  String mode = 'live';
  DateTimeRange? custom;
  late Future<Map<String, dynamic>> result;
  bool get flup => widget.business == AnalyticsBusiness.flupflap;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void didUpdateWidget(covariant AdminAnalyticsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.business != widget.business || oldWidget.dio != widget.dio) {
      load();
    }
  }

  String date(DateTime value) => value.toIso8601String().substring(0, 10);
  void load() {
    result = AdminAnalyticsService(dio: widget.dio).load(
      widget.business,
      period: period,
      mode: mode,
      start: period == 'custom' ? date(custom!.start) : null,
      end: period == 'custom' ? date(custom!.end) : null,
    );
    // Observe errors immediately; FutureBuilder still renders the original error.
    result.ignore();
  }

  Future<void> selectPeriod(String next) async {
    if (next == 'custom') {
      final now = DateTime.now().toUtc();
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(2020),
        lastDate: now,
        initialDateRange: custom,
        helpText: 'Custom period · UTC · maximum 366 days',
      );
      if (!mounted || picked == null) return;
      if (picked.end.difference(picked.start).inDays >= 366) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Choose at most 366 days.')),
        );
        return;
      }
      custom = picked;
    }
    setState(() {
      period = next;
      load();
    });
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 12,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                flup
                    ? 'FlupFlap business analytics'
                    : 'TiCash business analytics',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF142449),
                ),
              ),
              Text(
                flup
                    ? 'Recharge sales · separate from remittance'
                    : 'Remittance only · separate from FlupFlap',
                style: const TextStyle(color: Color(0xFF52627A)),
              ),
            ],
          ),
          IconButton(
            tooltip: 'Refresh analytics',
            onPressed: () => setState(load),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      const SizedBox(height: 16),
      Wrap(
        spacing: 8,
        runSpacing: 6,
        children: [
          for (final p in const [
            ('today', 'Today'),
            ('7d', '7 Days'),
            ('30d', '30 Days'),
            ('year', 'This Year'),
            ('custom', 'Custom'),
          ])
            ChoiceChip(
              label: Text(p.$2),
              selected: period == p.$1,
              selectedColor: const Color(0xFFDCEAFF),
              onSelected: (_) => selectPeriod(p.$1),
            ),
        ],
      ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SizedBox(
            width: 250,
            child: DropdownButton<String>(
              isExpanded: true,
              value: mode,
              underline: const SizedBox(),
              items: const [
                DropdownMenuItem(value: 'live', child: Text('Live records')),
                DropdownMenuItem(value: 'test', child: Text('Test records')),
              ],
              onChanged: (value) {
                if (value != null) {
                  setState(() {
                    mode = value;
                    load();
                  });
                }
              },
            ),
          ),
          const Text(
            'All dates UTC',
            style: TextStyle(color: Color(0xFF52627A)),
          ),
          if (period == 'custom')
            Text('${date(custom!.start)} – ${date(custom!.end)}'),
        ],
      ),
      const SizedBox(height: 12),
      FutureBuilder<Map<String, dynamic>>(
        future: result,
        builder: (context, snapshot) {
          // Do not display the old period's data while a new request is pending.
          if (snapshot.connectionState != ConnectionState.done) {
            return const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          if (snapshot.hasError) {
            return _box(
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Analytics unavailable',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                  const Text(
                    'Unable to load authorized database records. No estimated values are shown.',
                  ),
                  TextButton(
                    onPressed: () => setState(load),
                    child: const Text('Retry analytics'),
                  ),
                ],
              ),
            );
          }
          return content(snapshot.data!);
        },
      ),
    ],
  );

  Widget content(Map<String, dynamic> data) {
    final clients = data['clients'] as Map;
    final tx = data['transactions'] as Map;
    final cards = <(String, String, IconData, Color)>[
      (
        'Total clients',
        '${clients['total']}',
        Icons.people_outline,
        const Color(0xFF2563EB),
      ),
      (
        'Active clients',
        '${clients['active']}',
        Icons.person_outline,
        const Color(0xFF0891B2),
      ),
      (
        'New clients',
        '${clients['new']}',
        Icons.person_add_alt,
        const Color(0xFF7C3AED),
      ),
      if (flup) ...[
        (
          'Guest users',
          '${clients['guest']}',
          Icons.person_pin_outlined,
          const Color(0xFFEA580C),
        ),
        (
          'Registered clients',
          '${clients['registered']}',
          Icons.badge_outlined,
          const Color(0xFF2563EB),
        ),
      ],
      (
        'Total transactions',
        '${tx['total']}',
        Icons.swap_horiz,
        const Color(0xFF2563EB),
      ),
      (
        'Successful',
        '${tx['successful']}',
        Icons.check_circle_outline,
        const Color(0xFF059669),
      ),
      ('Pending', '${tx['pending']}', Icons.schedule, const Color(0xFFD97706)),
      (
        'Failed',
        '${tx['failed']}',
        Icons.error_outline,
        const Color(0xFFDC2626),
      ),
      (
        'Reversed / refunded',
        '${tx['reversed']}',
        Icons.undo,
        const Color(0xFF7C3AED),
      ),
      (
        flup ? 'Completed recharge sales' : 'Completed transfer volume',
        analyticsMoney(data['volumeCents']),
        Icons.trending_up,
        const Color(0xFF2563EB),
      ),
      (
        mode == 'test' ? 'Simulated fees' : 'Recorded fee revenue',
        analyticsMoney(data['feeRevenueCents']),
        Icons.toll,
        const Color(0xFF059669),
      ),
      (
        'Average completed amount',
        analyticsMoney(data['averageCents']),
        Icons.analytics_outlined,
        const Color(0xFF7C3AED),
      ),
      (
        'Transaction success rate',
        data['successRate'] == null ? '—' : '${data['successRate']}%',
        Icons.verified_outlined,
        const Color(0xFF0891B2),
      ),
    ];
    final trend = (data['trend'] as List).cast<Map<String, dynamic>>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '${data['start'].toString().substring(0, 10)} – ${data['end'].toString().substring(0, 10)} · USD · ${mode == 'test' ? 'TEST ACTIVITY ONLY' : 'LIVE RECORDS'}',
          style: const TextStyle(
            fontWeight: FontWeight.w700,
            color: Color(0xFF52627A),
          ),
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth > 1050
                ? 4
                : constraints.maxWidth > 700
                ? 3
                : constraints.maxWidth >= 300
                ? 2
                : 1;
            final width = (constraints.maxWidth - (columns - 1) * 12) / columns;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final c in cards)
                  SizedBox(
                    width: width,
                    child: _box(
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(c.$3, color: c.$4, size: 24),
                          const SizedBox(height: 10),
                          Text(
                            c.$2,
                            style: TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                              color: c.$4,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            c.$1,
                            style: const TextStyle(color: Color(0xFF52627A)),
                          ),
                        ],
                      ),
                      tint: c.$4.withValues(alpha: 0.045),
                    ),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 12),
        const Text(
          'Clients: accounts as of period end, across live/test activity. Active: at least one transaction in this period. Sales and fees count completed transactions only, grouped by creation date.',
          style: TextStyle(fontSize: 12, color: Color(0xFF52627A)),
        ),
        if ((data['unattributedFeeCount'] as num) > 0)
          Text(
            '${data['unattributedFeeCount']} completed transfers have no recorded TiCash fee attribution; excluded from fee revenue.',
            style: const TextStyle(color: Color(0xFFB45309)),
          ),
        const SizedBox(height: 20),
        _box(
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Sales trend',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
              ),
              const Text('Completed volume · daily · USD'),
              const SizedBox(height: 16),
              SizedBox(
                height: 170,
                child: Semantics(
                  label:
                      'Daily sales chart, ${trend.length} days. Accessible daily values below.',
                  child: CustomPaint(painter: _SalesChart(trend)),
                ),
              ),
              if (trend.isNotEmpty)
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(trend.first['date'].toString().substring(0, 10)),
                    Text(trend.last['date'].toString().substring(0, 10)),
                  ],
                ),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('Daily values'),
                children: [
                  for (final point in trend)
                    ListTile(
                      dense: true,
                      title: Text(point['date'].toString().substring(0, 10)),
                      trailing: Text(analyticsMoney(point['volumeCents'])),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _performance(
          data['performance'] as String,
          analyticsMoney(data['previousVolumeCents']),
        ),
        const SizedBox(height: 16),
        LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth > 800
                ? (constraints.maxWidth - 24) / 3
                : constraints.maxWidth;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                SizedBox(
                  width: width,
                  child: _breakdown('Top countries', data['countries'] as List),
                ),
                SizedBox(
                  width: width,
                  child: _breakdown(
                    'Product / service sales',
                    data['products'] as List,
                  ),
                ),
                SizedBox(
                  width: width,
                  child: _breakdown(
                    flup ? 'Top operators' : 'Payout providers',
                    data['operators'] as List,
                  ),
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 16),
        _box(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Subscription analytics',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              const Text(
                'Active subscribers · New subscriptions · Cancelled / expired · Subscription revenue',
              ),
              const Text(
                'Not available — this backend has no subscription records.',
                style: TextStyle(color: Color(0xFF52627A)),
              ),
              if (flup)
                const Padding(
                  padding: EdgeInsets.only(top: 10),
                  child: Text(
                    'Internet-plan sales: not available as a distinct provider product classification. Verified DATA and BUNDLE sales appear above.',
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _box(
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Recent transactions',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
              ),
              const Text(
                'Latest 10 in the selected period; totals include all records.',
              ),
              if ((data['recent'] as List).isEmpty)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('No transactions in this period.'),
                ),
              for (final row in data['recent'] as List)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    spacing: 12,
                    runSpacing: 6,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${row['operator']} · ${row['country']}',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            '${row['product']} · ${row['created'].toString().substring(0, 10)}',
                          ),
                          Text(
                            '${row['id']}',
                            style: const TextStyle(
                              fontSize: 11,
                              color: Color(0xFF52627A),
                            ),
                          ),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            analyticsMoney(row['amountCents']),
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          Text(
                            '${row['status']}',
                            style: TextStyle(
                              color: row['outcome'] == 'SUCCESS'
                                  ? const Color(0xFF047857)
                                  : const Color(0xFF9A3412),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _breakdown(String title, List rows) => _box(
    Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 10),
        if (rows.isEmpty) const Text('No completed sales.'),
        for (final row in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${row['name']}',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                Text(
                  '${row['count']} transactions · ${analyticsMoney(row['volumeCents'])}',
                ),
              ],
            ),
          ),
      ],
    ),
  );

  Widget _performance(String level, String previous) => _box(
    Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Sales performance',
          style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            for (final item in const [
              ('LOW', Color(0xFFEA580C)),
              ('MEDIUM', Color(0xFF2563EB)),
              ('HIGH', Color(0xFF059669)),
            ])
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  margin: const EdgeInsets.only(right: 4),
                  decoration: BoxDecoration(
                    color: item.$2.withValues(
                      alpha: level == item.$1 ? 1 : 0.08,
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    item.$1,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      color: level == item.$1 ? Colors.white : item.$2,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 10),
        if (level == 'NO_BASELINE')
          const Text('Not rated — no sales in the comparison period.'),
        Text(
          'Previous equal-length period: $previous. LOW: zero sales or more than 20% lower; MEDIUM: within ±20%; HIGH: more than 20% higher.',
          style: const TextStyle(fontSize: 12, color: Color(0xFF52627A)),
        ),
      ],
    ),
  );
}

Widget _box(Widget child, {Color tint = Colors.white}) => Material(
  color: tint,
  shape: RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(16),
    side: const BorderSide(color: Color(0xFFE2E8F0)),
  ),
  child: Padding(padding: const EdgeInsets.all(16), child: child),
);

class _SalesChart extends CustomPainter {
  _SalesChart(this.rows);
  final List<Map<String, dynamic>> rows;
  @override
  void paint(Canvas canvas, Size size) {
    final values = rows
        .map((r) => double.parse(r['volumeCents'].toString()) / 100)
        .toList();
    final maximum = values.fold<double>(1, math.max);
    final axis = Paint()
      ..color = const Color(0xFFE2E8F0)
      ..strokeWidth = 1;
    for (var i = 0; i < 4; i++) {
      final y = 10 + (size.height - 26) * i / 3;
      canvas.drawLine(Offset(58, y), Offset(size.width, y), axis);
      final label = TextPainter(
        text: TextSpan(
          text: '\$${(maximum * (3 - i) / 3).toStringAsFixed(0)}',
          style: const TextStyle(fontSize: 10, color: Color(0xFF64748B)),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: 54);
      label.paint(canvas, Offset(0, y));
    }
    if (values.isEmpty) return;
    final path = Path();
    for (var i = 0; i < values.length; i++) {
      final x = 58 + (size.width - 60) * i / math.max(1, values.length - 1);
      final y = 10 + (size.height - 26) * (1 - values[i] / maximum);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
      if (values.length == 1) {
        canvas.drawCircle(
          Offset(x, y),
          4,
          Paint()..color = const Color(0xFF2563EB),
        );
      }
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = const Color(0xFF2563EB)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );
  }

  @override
  bool shouldRepaint(covariant _SalesChart oldDelegate) =>
      oldDelegate.rows != rows;
}
