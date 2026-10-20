import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../services/api_client.dart';

class AppDownloadsPanel extends StatefulWidget {
  const AppDownloadsPanel({super.key, this.dio, this.canImport = false});
  final Dio? dio;
  final bool canImport;
  @override
  State<AppDownloadsPanel> createState() => _AppDownloadsPanelState();
}
class _AppDownloadsPanelState extends State<AppDownloadsPanel> {
  late Future<Map<String, dynamic>> result;
  int? year;
  String grouping = 'month';
  Dio get client => widget.dio ?? ApiClient.instance.dio;
  @override
  void initState() { super.initState(); load(); }
  @override
  void didUpdateWidget(covariant AppDownloadsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.dio != widget.dio) load();
  }
  void load() {
    result = client.get('/admin/flupflap/downloads', queryParameters: {
      if (year != null) 'year': year, 'groupBy': grouping,
    }).then((r) {
      final data = Map<String, dynamic>.from(r.data as Map);
      if (data['domain'] != 'FLUPFLAP' || data['platforms'] is! List || data['series'] is! List) {
        throw const FormatException('Unexpected download report');
      }
      year ??= (data['year'] as int?) ?? DateTime.now().year;
      return data;
    });
    result.ignore();
  }
  Future<void> importReport() async {
    final imported = await showDialog<bool>(context: context, barrierDismissible: false,
      builder: (_) => _DownloadImportDialog(client: client));
    if (mounted && imported == true) setState(load);
  }
  String total(Map period) {
    if (period['count'] == null) return '—';
    return '${period['count']}${period['reportedDays'] == period['expectedDays'] ? '' : ' *'}';
  }
  @override
  Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(
    crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, children: [
        const Text('FlupFlap Recharge · App downloads', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
        Row(mainAxisSize: MainAxisSize.min, children: [
          if (widget.canImport) TextButton.icon(onPressed: importReport, icon: const Icon(Icons.upload_file), label: const Text('Import report')),
          IconButton(onPressed: () => setState(load), tooltip: 'Refresh downloads', icon: const Icon(Icons.refresh)),
        ]),
      ]),
      const Text('Android and iOS store reports · Pacific reporting dates · weekly periods start Monday'),
      const SizedBox(height: 12),
      FutureBuilder<Map<String, dynamic>>(future: result, builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (snapshot.hasError) { return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Download reports unavailable. No estimated counts are shown.'),
          TextButton(onPressed: () => setState(load), child: const Text('Retry downloads')),
        ]); }
        final data = snapshot.data!;
        final platforms = (data['platforms'] as List).cast<Map>();
        final series = (data['series'] as List).cast<Map>();
        final currentYear = int.tryParse('${data['asOf'] ?? ''}'.split('-').first) ?? DateTime.now().year;
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SingleChildScrollView(scrollDirection: Axis.horizontal, child: DataTable(columns: const [
            DataColumn(label: Text('Platform')), DataColumn(label: Text('Today'), numeric: true),
            DataColumn(label: Text('This week'), numeric: true), DataColumn(label: Text('This month'), numeric: true),
            DataColumn(label: Text('This year'), numeric: true),
          ], rows: platforms.map((p) => DataRow(cells: [
            DataCell(Text(p['platform'] == 'ANDROID' ? 'Android' : 'iOS')),
            for (final period in ['today', 'week', 'month', 'year']) DataCell(Text(total(p[period] as Map))),
          ])).toList())),
          const SizedBox(height: 8),
          const Text('— No report received.  * Partial period: only reported days are counted. Downloads are not unique people across platforms.'),
          for (final p in platforms) Padding(padding: const EdgeInsets.only(top: 8), child: Text(
            '${p['source']}\nLatest report: ${p['lastReportDate'] ?? 'Not imported'} · Last import: ${p['lastImportedAt'] ?? 'Never'}',
          )),
          if (data['iosConfigured'] == false) const Padding(padding: EdgeInsets.only(top: 8), child: Text('iOS reports are not connected. Configure the App Store app ID before importing.')),
          const Divider(height: 32),
          Wrap(spacing: 12, crossAxisAlignment: WrapCrossAlignment.center, children: [
            const Text('Download history'),
            DropdownButton<int>(value: year, items: [for (int y = currentYear; y >= 2020; y--)
              DropdownMenuItem(value: y, child: Text('$y'))], onChanged: (v) => setState(() { year = v!; load(); })),
            for (final option in const [('day', 'Daily'), ('week', 'Weekly'), ('month', 'Monthly'), ('year', 'Yearly')])
              ChoiceChip(label: Text(option.$2), selected: grouping == option.$1,
                onSelected: (_) => setState(() { grouping = option.$1; load(); })),
          ]),
          const Text('History is limited to the selected calendar year. Incomplete periods are marked *.'),
          SizedBox(height: 260, child: SingleChildScrollView(child: SingleChildScrollView(scrollDirection: Axis.horizontal,
            child: DataTable(columns: const [DataColumn(label: Text('Period')), DataColumn(label: Text('Android'), numeric: true), DataColumn(label: Text('iOS'), numeric: true)],
              rows: series.map((row) => DataRow(cells: [DataCell(Text('${row['date']}')),
                for (final platform in ['android', 'ios']) DataCell(Text(row[platform] == null ? '—' : '${row[platform]}${(row['reportedDays'] as Map)[platform] == row['expectedDays'] ? '' : ' *'}')),
              ])).toList()),
          ))),
        ]);
      }),
    ],
  )));
}

class _DownloadImportDialog extends StatefulWidget {
  const _DownloadImportDialog({required this.client});
  final Dio client;
  @override
  State<_DownloadImportDialog> createState() => _DownloadImportDialogState();
}
class _DownloadImportDialogState extends State<_DownloadImportDialog> {
  final report = TextEditingController();
  String platform = 'ANDROID';
  String? error;
  bool saving = false;
  @override
  void dispose() { report.dispose(); super.dispose(); }
  Future<void> submit() async {
    setState(() { saving = true; error = null; });
    try {
      await widget.client.post('/admin/flupflap/downloads/import', data: {'platform': platform, 'report': report.text});
      if (mounted) Navigator.pop(context, true);
    } on DioException catch (e) {
      final code = e.response?.data is Map ? e.response?.data['code'] : null;
      if (mounted) { setState(() { saving = false; error = code == 'STORE_APP_NOT_CONFIGURED'
        ? 'The iOS App Store app ID must be configured on the server first.'
        : 'Import failed (${code ?? 'network error'}). Check the report format and try again.'; }); }
    } catch (_) {
      if (mounted) setState(() { saving = false; error = 'Import failed. Try again.'; });
    }
  }
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Import store download report'),
    content: SizedBox(width: 620, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      DropdownButton<String>(value: platform, isExpanded: true, items: const [
        DropdownMenuItem(value: 'ANDROID', child: Text('Android · Google Play')),
        DropdownMenuItem(value: 'IOS', child: Text('iOS · App Store')),
      ], onChanged: saving ? null : (value) => setState(() { platform = value!; error = null; })),
      const Text('Paste the complete Google Play installs CSV (Country dimension or no dimension), or an Apple DAILY Summary Sales TSV. Include the header and all countries. Do not combine exports or filter countries. Maximum 100,000 characters.'),
      const SizedBox(height: 12),
      TextField(controller: report, enabled: !saving, minLines: 5, maxLines: 10, maxLength: 100000,
        decoration: const InputDecoration(labelText: 'Official report contents', border: OutlineInputBorder())),
      const Text('Re-imports replace daily counts instead of adding them again. Missing dates stay unavailable. Only aggregate counts are retained.'),
      if (error != null) Text(error!, style: const TextStyle(color: Colors.red)),
    ]))),
    actions: [
      TextButton(onPressed: saving ? null : () => Navigator.pop(context, false), child: const Text('Cancel')),
      FilledButton(onPressed: saving ? null : submit, child: Text(saving ? 'Importing…' : 'Import report')),
    ],
  );
}
