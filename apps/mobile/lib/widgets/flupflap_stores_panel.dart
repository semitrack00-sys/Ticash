import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

class FlupFlapStoresPanel extends StatefulWidget {
  const FlupFlapStoresPanel({
    super.key,
    required this.dio,
    required this.canManage,
    required this.canFund,
  });
  final Dio dio;
  final bool canManage, canFund;
  @override
  State<FlupFlapStoresPanel> createState() => _FlupFlapStoresPanelState();
}

class _FlupFlapStoresPanelState extends State<FlupFlapStoresPanel> {
  Map<String, dynamic>? data;
  bool busy = false;
  String? error;
  int offset = 0;
  final search = TextEditingController();
  String money(dynamic value) =>
      '\$${((value as num? ?? 0) / 100).toStringAsFixed(2)}';
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> load() async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.dio.get(
        '/admin/flupflap/stores',
        queryParameters: {'offset': offset},
      );
      if (mounted) {
        setState(() {
          data = Map<String, dynamic>.from(result.data as Map);
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          error =
              'Unable to load stores. Check availability and permissions, then refresh.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
        });
      }
    }
  }

  Future<void> act(
    String path,
    Map<String, dynamic> body, {
    bool patch = false,
  }) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      if (patch) {
        await widget.dio.patch(path, data: body);
      } else {
        await widget.dio.post(path, data: body);
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          error =
              'The action could not be confirmed. Refresh before retrying. Country activation may be required.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
        });
      }
    }
    if (mounted && error == null) await load();
  }

  Future<void> review(Map store, String status) async {
    var reason = '';
    var commission = '${(store['commissionBps'] as num) / 100}';
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('$status · ${store['name']}'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Verify the business details before activating. Commission applies to the service fee, not the whole customer payment.',
              ),
              TextFormField(
                initialValue: commission,
                onChanged: (value) => commission = value,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Commission % of service fee (0–50)',
                ),
              ),
              TextField(
                onChanged: (value) => reason = value,
                decoration: const InputDecoration(
                  labelText: 'Review reason (required)',
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
            child: const Text('Save review'),
          ),
        ],
      ),
    );
    final rate = double.tryParse(commission), note = reason.trim();
    if (accepted != true || !mounted) return;
    if (rate == null || rate < 0 || rate > 50 || note.length < 5) {
      setState(() {
        error =
            'Enter a commission from 0 to 50 and a review reason of at least 5 characters.';
      });
      return;
    }
    await act('/admin/flupflap/stores/${store['id']}', {
      'status': status,
      'commissionBps': (rate * 100).round(),
      'reason': note,
    }, patch: true);
  }

  Future<void> reviewDeposit(Map deposit, bool approve) async {
    var reason = '';
    bool verified = false;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text(
            '${approve ? 'Credit' : 'Reject'} ${money(deposit['amountCents'])} USD',
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${deposit['store']['name']}\nTransfer reference: ${deposit['reference']}',
                ),
                if (approve)
                  CheckboxListTile(
                    value: verified,
                    onChanged: (value) => update(() {
                      verified = value == true;
                    }),
                    title: const Text(
                      'I independently verified that these funds were received.',
                    ),
                  ),
                TextField(
                  onChanged: (value) => reason = value,
                  decoration: const InputDecoration(
                    labelText: 'Verification / rejection reason',
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
              onPressed: approve && !verified
                  ? null
                  : () => Navigator.pop(context, true),
              child: Text(approve ? 'Credit balance' : 'Reject'),
            ),
          ],
        ),
      ),
    );
    final note = reason.trim();
    if (accepted != true || !mounted) return;
    if (note.length < 5) {
      setState(() {
        error = 'Enter a review reason of at least 5 characters.';
      });
      return;
    }
    await act('/admin/flupflap/stores/funding/${deposit['id']}/review', {
      'approve': approve,
      'fundsReceived': verified,
      'reason': note,
    });
  }

  Future<void> recordReturn(Map store) async {
    var amount = '', reference = '';
    bool verified = false;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: const Text('Record a completed balance return'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Return the funds through your approved payment process first. This records the completed return and deducts the store balance.',
                ),
                TextField(
                  onChanged: (value) => amount = value,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Returned amount in USD',
                  ),
                ),
                TextField(
                  onChanged: (value) => reference = value,
                  decoration: const InputDecoration(
                    labelText: 'Completed return reference',
                  ),
                ),
                CheckboxListTile(
                  value: verified,
                  onChanged: (value) => update(() {
                    verified = value == true;
                  }),
                  title: const Text('I verified that the funds were returned.'),
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
              onPressed: !verified ? null : () => Navigator.pop(context, true),
              child: const Text('Record completed return'),
            ),
          ],
        ),
      ),
    );
    final value = double.tryParse(amount), note = reference.trim();
    if (accepted != true || !mounted) return;
    if (value == null ||
        value <= 0 ||
        value > 10000 ||
        (value * 100 - (value * 100).round()).abs() > 0.00001 ||
        note.length < 5) {
      setState(() {
        error = 'Enter a valid amount and a completed return reference.';
      });
      return;
    }
    await act('/admin/flupflap/stores/${store['id']}/balance-return', {
      'amountCents': (value * 100).round(),
      'reference': note,
      'fundsReturned': true,
    });
  }

  @override
  Widget build(BuildContext context) {
    final stores = (data?['stores'] as List? ?? []).where(
      (item) =>
          '${item['name']} ${item['country']} ${item['contactName']} ${item['status']} ${item['id']}'
              .toLowerCase()
              .contains(search.text.toLowerCase()),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'Store sellers',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
            ),
            IconButton(
              onPressed: busy ? null : load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        if (busy) const LinearProgressIndicator(),
        if (error != null)
          Text(error!, style: const TextStyle(color: Colors.red)),
        if (data?['testMode'] == true)
          const Text('Test environment — simulated balances.'),
        const Text(
          'USD prepaid balances. Default commission: 20% of the service fee. Deposit approval records verified funds; it does not transfer money.',
        ),
        if (data != null)
          Text(
            'Enabled store countries: ${(data!['enabledCountries'] as List).join(', ')}',
          ),
        TextField(
          controller: search,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: 'Search stores on this page',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        for (final store in stores)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${store['name']} · ${store['status']}',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  Text(
                    '${store['contactName']} · ${store['phone']}\n${store['address']} · ${store['country']}',
                  ),
                  Text(
                    'Balance: ${money(store['balanceCents'])} USD · Commission: ${(store['commissionBps'] as num) / 100}% of service fee',
                  ),
                  if (widget.canManage)
                    Wrap(
                      spacing: 8,
                      children: [
                        for (final status in [
                          'ACTIVE',
                          'SUSPENDED',
                          'REJECTED',
                        ])
                          OutlinedButton(
                            onPressed: busy
                                ? null
                                : () => review(store as Map, status),
                            child: Text(
                              status == 'ACTIVE'
                                  ? 'Approve / edit commission'
                                  : status,
                            ),
                          ),
                      ],
                    ),
                  if (widget.canFund && (store['balanceCents'] as num) > 0)
                    TextButton(
                      onPressed: busy ? null : () => recordReturn(store as Map),
                      child: const Text('Record completed balance return'),
                    ),
                ],
              ),
            ),
          ),
        Row(
          children: [
            TextButton(
              onPressed: busy || offset == 0
                  ? null
                  : () {
                      offset -= 50;
                      load();
                    },
              child: const Text('Previous'),
            ),
            Text(
              '${offset + 1}–${offset + (data?['stores'] as List? ?? []).length} of ${data?['total'] ?? 0}',
            ),
            TextButton(
              onPressed: busy || offset + 50 >= (data?['total'] as num? ?? 0)
                  ? null
                  : () {
                      offset += 50;
                      load();
                    },
              child: const Text('Next'),
            ),
          ],
        ),
        const SizedBox(height: 20),
        const Text(
          'Pending deposits (oldest 100)',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        for (final deposit in (data?['funding'] as List? ?? []))
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${deposit['store']['name']} · ${money(deposit['amountCents'])} USD',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  Text(
                    'Reference: ${deposit['reference']}\n${deposit['createdAt']}',
                  ),
                  if (widget.canFund)
                    Wrap(
                      spacing: 8,
                      children: [
                        TextButton(
                          onPressed: busy
                              ? null
                              : () => reviewDeposit(deposit as Map, false),
                          child: const Text('Reject'),
                        ),
                        FilledButton(
                          onPressed: busy
                              ? null
                              : () => reviewDeposit(deposit as Map, true),
                          child: const Text('Verify deposit'),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
