import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

/// Existing TiCash staff session/permissions remain authoritative on the API.
/// Campaign money is shown in USD cents; test ledgers never imply real payouts.
class FlupFlapPromotionsPanel extends StatefulWidget {
  const FlupFlapPromotionsPanel({
    super.key,
    required this.dio,
    required this.canManage,
  });
  final Dio dio;
  final bool canManage;
  @override
  State<FlupFlapPromotionsPanel> createState() =>
      _FlupFlapPromotionsPanelState();
}

class _FlupFlapPromotionsPanelState extends State<FlupFlapPromotionsPanel> {
  static const path = '/admin/flupflap/promotions';
  late Future<List<Response<dynamic>>> records;
  String? error;
  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() {
    records = Future.wait([
      widget.dio.get(path),
      widget.dio.get('$path/promoters'),
      widget.dio.get('$path/rewards'),
    ]);
  }

  String usd(dynamic cents) =>
      '\$${((cents as num? ?? 0) / 100).toStringAsFixed(2)} USD';

  Future<void> addPromoter() async {
    final name = TextEditingController();
    final identity = TextEditingController();
    final approved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create promoter'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: name,
              decoration: const InputDecoration(labelText: 'Promoter name'),
            ),
            TextField(
              controller: identity,
              decoration: const InputDecoration(
                labelText: 'Verified FlupFlap customer ID (optional)',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    final input = {
      'name': name.text.trim(),
      if (identity.text.trim().isNotEmpty) 'customerId': identity.text.trim(),
    };
    name.dispose();
    identity.dispose();
    if (approved != true) return;
    await mutate(() => widget.dio.post('$path/promoters', data: input));
  }

  Future<void> mutate(Future<dynamic> Function() action) async {
    if (!widget.canManage) return;
    try {
      await action();
      if (mounted) {
        setState(() {
          error = null;
          reload();
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          error = 'Operation not accepted. Check eligibility, dates, permissions and required fields. No success was assumed.';
        });
      }
    }
  }

  Future<void> editCampaign(
    List<dynamic> promoters,
    Map<String, dynamic>? campaign,
  ) async {
    final input = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _CampaignEditor(promoters: promoters, initial: campaign),
    );
    if (input == null) return;
    await mutate(
      () => campaign == null
          ? widget.dio.post('$path/campaigns', data: input)
          : widget.dio.put('$path/campaigns/${campaign['id']}', data: input),
    );
  }

  Future<void> rewardStatus(Map<String, dynamic> reward, String status) async {
    final reason = TextEditingController();
    final approved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Record $status'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'This records an audited ledger decision. It does not execute a payout.',
            ),
            TextField(
              controller: reason,
              decoration: const InputDecoration(
                labelText: 'Reason / evidence (required)',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Record'),
          ),
        ],
      ),
    );
    final text = reason.text.trim();
    reason.dispose();
    if (approved == true && text.length >= 5) {
      await mutate(
        () => widget.dio.patch(
          '$path/rewards/${reward['id']}',
          data: {'status': status, 'reason': text},
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<Response<dynamic>>>(
    future: records,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError) {
        return Column(
          children: [
            const Text(
              'Promotions are unavailable. No campaign values are assumed.',
            ),
            TextButton(
              onPressed: () => setState(reload),
              child: const Text('Retry'),
            ),
          ],
        );
      }
      final campaigns = (snapshot.data![0].data['campaigns'] as List?) ?? [];
      final promoters = (snapshot.data![1].data['promoters'] as List?) ?? [];
      final rewards = (snapshot.data![2].data['rewards'] as List?) ?? [];
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Promotions / Influencers',
            style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          const Text(
            'Live monetary promotions and automatic payouts are disabled. Test campaign balances are separate from real revenue.',
          ),
          if (error != null)
            Text(error!, style: const TextStyle(color: Colors.red)),
          if (widget.canManage)
            Wrap(
              spacing: 12,
              children: [
                TextButton.icon(
                  onPressed: addPromoter,
                  icon: const Icon(Icons.person_add_outlined),
                  label: const Text('Create promoter'),
                ),
                FilledButton.icon(
                  onPressed: promoters.isEmpty
                      ? null
                      : () => editCampaign(promoters, null),
                  icon: const Icon(Icons.add),
                  label: const Text('Create campaign'),
                ),
              ],
            ),
          const SizedBox(height: 12),
          if (campaigns.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text('No campaigns yet.'),
              ),
            ),
          for (final raw in campaigns)
            Builder(
              builder: (context) {
                final c = Map<String, dynamic>.from(raw as Map);
                final funnel = (c['funnel'] as Map?) ?? {};
                final views = (funnel['LANDING_VIEWED'] as num?) ?? 0;
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Wrap(
                          spacing: 12,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(
                              '${c['name']}',
                              style: const TextStyle(
                                fontSize: 19,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            Chip(label: Text('${c['status']}')),
                            Chip(
                              label: Text(
                                c['testMode'] == true
                                    ? 'TEST'
                                    : 'ATTRIBUTION ONLY',
                              ),
                            ),
                          ],
                        ),
                        SelectableText('${c['code']} · ${c['shareUrl']}'),
                        Text('${c['startsAt']} → ${c['endsAt']}'),
                        const SizedBox(height: 16),
                        for (final stage in [
                          ('Landing views', views),
                          ('Signup starts', funnel['SIGNUP_STARTED'] ?? 0),
                          ('Accounts created', funnel['ACCOUNT_CREATED'] ?? 0),
                          ('Qualified customers', c['qualifiedCustomers'] ?? 0),
                          (
                            'Successful recharges',
                            c['successfulRecharges'] ?? 0,
                          ),
                        ])
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 5),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text('${stage.$1}: ${stage.$2}'),
                                const SizedBox(height: 4),
                                LinearProgressIndicator(
                                  value: views == 0
                                      ? 0
                                      : ((stage.$2 as num) / views)
                                            .clamp(0, 1)
                                            .toDouble(),
                                  minHeight: 7,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                              ],
                            ),
                          ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 20,
                          runSpacing: 8,
                          children: [
                            Text(
                              'Promo cost: ${usd(c['promotionalCostCents'])}',
                            ),
                            Text(
                              'Attributable fees: ${usd(c['attributableFeeCents'])}',
                            ),
                            Text(
                              'Conversion: ${c['conversionRate'] == null ? 'Unavailable' : '${((c['conversionRate'] as num) * 100).toStringAsFixed(1)}%'}',
                            ),
                          ],
                        ),
                        for (final r in (c['rewards'] as List? ?? []))
                          Text('${r['status']}: ${usd(r['amountCents'])}'),
                        if (widget.canManage && c['status'] != 'REVOKED')
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                              onPressed: () => editCampaign(promoters, c),
                              child: const Text('Manage campaign'),
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          const SizedBox(height: 20),
          const Text(
            'Reward ledger',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          if (rewards.isEmpty) const Text('No verified reward records.'),
          for (final raw in rewards)
            Builder(
              builder: (context) {
                final r = Map<String, dynamic>.from(raw as Map);
                final next = {
                  'PENDING': 'APPROVED',
                  'APPROVED': 'PAYABLE',
                  'PAYABLE': 'PAID',
                }[r['status']];
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${usd(r['amountCents'])} · ${r['status']} · ${r['testMode'] == true ? 'TEST' : 'LIVE'}',
                        ),
                        Text('${r['createdAt']}'),
                        if (widget.canManage)
                          Wrap(
                            spacing: 12,
                            children: [
                              if (next != null &&
                                  !(r['testMode'] == true && next == 'PAID'))
                                TextButton(
                                  onPressed: () => rewardStatus(r, next),
                                  child: Text('Record $next'),
                                ),
                              if (r['status'] != 'REVERSED')
                                TextButton(
                                  onPressed: () => rewardStatus(r, 'REVERSED'),
                                  child: const Text('Reverse with reason'),
                                ),
                            ],
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          const Text(
            'Shows up to 100 recent campaigns and ledger records. Each campaign aggregate covers its complete history. Customer PII is excluded.',
          ),
        ],
      );
    },
  );
}

class _CampaignEditor extends StatefulWidget {
  const _CampaignEditor({required this.promoters, this.initial});
  final List<dynamic> promoters;
  final Map<String, dynamic>? initial;
  @override
  State<_CampaignEditor> createState() => _CampaignEditorState();
}

class _CampaignEditorState extends State<_CampaignEditor> {
  final form = GlobalKey<FormState>();
  final fields = <String, TextEditingController>{};
  late String promoter, status, benefit, reward;
  late bool testMode, newOnly, firstOnly, guest, registered, coAttribution;
  @override
  void initState() {
    super.initState();
    final c = widget.initial ?? {};
    final r = (c['rules'] as Map?) ?? {};
    final b = (r['benefit'] as Map?) ?? {};
    final w = (r['reward'] as Map?) ?? {};
    promoter = '${c['promoterId'] ?? widget.promoters.first['id']}';
    status = '${c['status'] ?? 'DRAFT'}';
    benefit = '${b['type'] ?? 'NONE'}';
    reward = '${w['type'] ?? 'NONE'}';
    testMode = c['testMode'] != false;
    newOnly = r['newCustomerOnly'] != false;
    firstOnly = r['firstRechargeOnly'] != false;
    guest = (r['customerTypes'] as List? ?? []).contains('GUEST');
    registered = (r['customerTypes'] as List? ?? ['REGISTERED']).contains(
      'REGISTERED',
    );
    coAttribution = r['allowReferralAttribution'] == true;
    final values = <String, dynamic>{
      'name': c['name'] ?? '',
      'code': c['code'] ?? '',
      'startsAt': c['startsAt'] ?? DateTime.now().toUtc().toIso8601String(),
      'endsAt':
          c['endsAt'] ??
          DateTime.now()
              .toUtc()
              .add(const Duration(days: 30))
              .toIso8601String(),
      'countries': (r['countries'] as List? ?? []).join(','),
      'operators': (r['operators'] as List? ?? []).join(','),
      'products': (r['products'] as List? ?? []).join(','),
      'maxRedemptions': r['maxRedemptions'] ?? 100,
      'maxPerCustomer': r['maxPerCustomer'] ?? 1,
      'benefitValue': b['cents'] ?? b['basisPoints'] ?? 0,
      'rewardValue': w['cents'] ?? w['basisPoints'] ?? 0,
      'milestone': w['every'] ?? 10,
      'reason': '',
    };
    for (final entry in values.entries) {
      fields[entry.key] = TextEditingController(text: '${entry.value}');
    }
  }

  @override
  void dispose() {
    for (final c in fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  Widget field(
    String key,
    String label, {
    bool optional = false,
    bool number = false,
  }) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: TextFormField(
      controller: fields[key],
      keyboardType: number ? TextInputType.number : TextInputType.text,
      decoration: InputDecoration(labelText: label),
      validator: (value) {
        if (!optional && (value ?? '').trim().isEmpty) return 'Required';
        if (number && int.tryParse(value ?? '') == null) {
          return 'Use whole numbers';
        }
        if (key.endsWith('At') && DateTime.tryParse(value ?? '') == null) {
          return 'Use a valid ISO date/time';
        }
        if (key == 'reason' && (value ?? '').trim().length < 5) {
          return 'Explain the change';
        }
        return null;
      },
    ),
  );
  Widget select(
    String label,
    String value,
    List<String> choices,
    ValueChanged<String> update,
  ) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: choices
          .map((s) => DropdownMenuItem(value: s, child: Text(s)))
          .toList(),
      onChanged: (v) {
        if (v != null) setState(() => update(v));
      },
    ),
  );
  List<String> csv(String key) => fields[key]!.text
      .split(',')
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList();
  void save() {
    if (!form.currentState!.validate() || (!guest && !registered)) return;
    final operators = csv('operators').map(int.tryParse).toList();
    if (operators.any((n) => n == null || n <= 0)) return;
    final b = {
      'type': benefit,
      if (benefit == 'PERCENT_FEE')
        'basisPoints': int.parse(fields['benefitValue']!.text),
      if (['FEE_CREDIT', 'FIXED_DISCOUNT', 'REDUCED_FEE'].contains(benefit))
        'cents': int.parse(fields['benefitValue']!.text),
    };
    final w = {
      'type': reward,
      if (reward == 'PERCENT_FEE')
        'basisPoints': int.parse(fields['rewardValue']!.text),
      if (['FIXED_CUSTOMER', 'FIXED_RECHARGE', 'MILESTONE'].contains(reward))
        'cents': int.parse(fields['rewardValue']!.text),
      if (reward == 'MILESTONE') 'every': int.parse(fields['milestone']!.text),
    };
    Navigator.pop(context, {
      'name': fields['name']!.text.trim(),
      'promoterId': promoter,
      if (fields['code']!.text.trim().isNotEmpty)
        'code': fields['code']!.text.trim(),
      'status': status,
      'testMode': testMode,
      'startsAt': DateTime.parse(fields['startsAt']!.text)
          .toUtc()
          .toIso8601String(),
      'endsAt': DateTime.parse(fields['endsAt']!.text)
          .toUtc()
          .toIso8601String(),
      'reason': fields['reason']!.text.trim(),
      'rules': {
        'countries': csv('countries').map((c) => c.toUpperCase()).toList(),
        'operators': operators,
        'products': csv('products'),
        'customerTypes': [if (registered) 'REGISTERED', if (guest) 'GUEST'],
        'newCustomerOnly': newOnly,
        'firstRechargeOnly': firstOnly,
        'maxRedemptions': int.parse(fields['maxRedemptions']!.text),
        'maxPerCustomer': int.parse(fields['maxPerCustomer']!.text),
        'allowReferralAttribution': coAttribution,
        'benefit': b,
        'reward': w,
      },
    });
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.initial == null ? 'Create campaign' : 'Manage campaign'),
    content: SizedBox(
      width: 620,
      child: SingleChildScrollView(
        child: Form(
          key: form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Monetary benefits and rewards are sandbox-only. Percentage values use basis points (100 = 1%). All discounts are capped at the FlupFlap fee; principal is untouched.',
              ),
              field('name', 'Campaign name'),
              field(
                'code',
                'Promo code (leave empty to generate)',
                optional: true,
              ),
              DropdownButtonFormField<String>(
                initialValue: promoter,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Promoter'),
                items: widget.promoters
                    .map(
                      (p) => DropdownMenuItem(
                        value: '${p['id']}',
                        child: Text('${p['name']}'),
                      ),
                    )
                    .toList(),
                onChanged: widget.initial != null
                    ? null
                    : (v) => setState(() {
                        promoter = v!;
                      }),
              ),
              select('Status', status, [
                'DRAFT',
                'ACTIVE',
                'PAUSED',
                'DISABLED',
                'EXPIRED',
                'REVOKED',
              ], (v) => status = v),
              SwitchListTile(
                title: const Text('Test campaign'),
                value: testMode,
                onChanged: widget.initial != null
                    ? null
                    : (v) => setState(() {
                        testMode = v;
                        if (!v) {
                          benefit = reward = 'NONE';
                        }
                      }),
              ),
              field('startsAt', 'Starts at (UTC ISO date/time)'),
              field('endsAt', 'Expires at (UTC ISO date/time)'),
              field(
                'countries',
                'Eligible country codes (comma-separated; empty = all)',
                optional: true,
              ),
              field(
                'operators',
                'Provider operator IDs (comma-separated; empty = all)',
                optional: true,
              ),
              field(
                'products',
                'Provider product IDs (comma-separated; empty = all)',
                optional: true,
              ),
              CheckboxListTile(
                title: const Text('Registered customers'),
                value: registered,
                onChanged: (v) => setState(() {
                  registered = v!;
                }),
              ),
              CheckboxListTile(
                title: const Text('Guests'),
                value: guest,
                onChanged: (v) => setState(() {
                  guest = v!;
                }),
              ),
              CheckboxListTile(
                title: const Text('New customers only'),
                value: newOnly,
                onChanged: (v) => setState(() {
                  newOnly = v!;
                }),
              ),
              CheckboxListTile(
                title: const Text('First successful recharge only'),
                value: firstOnly,
                onChanged: (v) => setState(() {
                  firstOnly = v!;
                }),
              ),
              CheckboxListTile(
                title: const Text(
                  'Allow referral co-attribution (no second discount)',
                ),
                value: coAttribution,
                onChanged: (v) => setState(() {
                  coAttribution = v!;
                }),
              ),
              field(
                'maxRedemptions',
                'Maximum campaign redemptions',
                number: true,
              ),
              field('maxPerCustomer', 'Maximum per customer', number: true),
              select(
                'Customer benefit',
                benefit,
                testMode
                    ? [
                        'NONE',
                        'FEE_CREDIT',
                        'FIXED_DISCOUNT',
                        'REDUCED_FEE',
                        'PERCENT_FEE',
                        'WAIVED_FEE',
                      ]
                    : ['NONE'],
                (v) => benefit = v,
              ),
              if (!['NONE', 'WAIVED_FEE'].contains(benefit))
                field(
                  'benefitValue',
                  benefit == 'PERCENT_FEE'
                      ? 'Discount basis points'
                      : 'Benefit / reduced fee (USD cents)',
                  number: true,
                ),
              select(
                'Separate promoter reward',
                reward,
                testMode
                    ? [
                        'NONE',
                        'FIXED_CUSTOMER',
                        'FIXED_RECHARGE',
                        'PERCENT_FEE',
                        'MILESTONE',
                      ]
                    : ['NONE'],
                (v) => reward = v,
              ),
              if (reward != 'NONE')
                field(
                  'rewardValue',
                  reward == 'PERCENT_FEE'
                      ? 'Fee-revenue basis points'
                      : 'Reward (USD cents)',
                  number: true,
                ),
              if (reward == 'MILESTONE')
                field(
                  'milestone',
                  'Every N qualifying recharges',
                  number: true,
                ),
              field('reason', 'Reason for this administrative change'),
            ],
          ),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(onPressed: save, child: const Text('Save campaign')),
    ],
  );
}
