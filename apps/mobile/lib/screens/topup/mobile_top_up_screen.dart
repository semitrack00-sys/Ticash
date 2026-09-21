import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/theme.dart';
import '../../models/mobile_top_up.dart';
import '../../providers/mobile_top_up_provider.dart';

class MobileTopUpScreen extends ConsumerStatefulWidget {
  const MobileTopUpScreen({super.key});
  @override
  ConsumerState<MobileTopUpScreen> createState() => _MobileTopUpScreenState();
}

class _MobileTopUpScreenState extends ConsumerState<MobileTopUpScreen> {
  final _phone = TextEditingController();
  final _nickname = TextEditingController();
  final _customAmount = TextEditingController();
  String? _countryCode;
  MobileTopUpOperator? _operator;
  MobileTopUpProduct? _product;
  List<MobileTopUpOperator> _operators = const [];
  List<MobileTopUpProduct> _products = const [];
  MobileTopUpQuote? _quote;
  MobileTopUpTransaction? _receipt;
  bool _busy = false;
  bool _history = false;
  String? _error;
  late final ProviderSubscription<AsyncValue<List<MobileTopUpCountry>>>
      _countriesSubscription;

  @override
  void initState() {
    super.initState();
    _countriesSubscription = ref.listenManual(
      mobileTopUpCountriesProvider,
      (_, next) {
        final countries = next.asData?.value;
        if (countries == null || countries.isEmpty) return;
        final resolvedCountryCode =
            countries.any((item) => item.code == _countryCode)
                ? (_countryCode ?? countries.first.code)
                : countries.first.code;
        if (mounted && _countryCode != resolvedCountryCode) {
          setState(() => _countryCode = resolvedCountryCode);
        }
      },
    );
  }

  @override
  void dispose() {
    _countriesSubscription.close();
    _phone.dispose();
    _nickname.dispose();
    _customAmount.dispose();
    super.dispose();
  }

  String _message(Object error) {
    if (error is DioException && error.response?.data is Map) {
      return ((error.response!.data as Map)['error'] as String?) ??
          'Mobile Recharge is temporarily unavailable.';
    }
    return 'Mobile Recharge is temporarily unavailable.';
  }

  Future<void> _run(Future<void> Function() task) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await task();
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    }
    if (mounted) setState(() => _busy = false);
  }

  void _clearRechargeState({
    bool clearPhone = false,
    bool clearNickname = false,
  }) {
    _operator = null;
    _product = null;
    _operators = const [];
    _products = const [];
    _quote = null;
    _receipt = null;
    _error = null;
    if (clearPhone) _phone.clear();
    if (clearNickname) _nickname.clear();
    _customAmount.clear();
  }

  Future<void> _detect(String countryCode) => _run(() async {
    final service = ref.read(mobileTopUpServiceProvider);
    List<MobileTopUpOperator> operators;
    MobileTopUpOperator selected;
    try {
      selected = await service.detectOperator(
        countryCode: countryCode,
        phone: _phone.text,
      );
      operators = [selected];
    } catch (_) {
      final items = await service.operators(countryCode);
      if (items.isEmpty) rethrow;
      operators = items;
      selected = items.first;
    }
    final products = await service.products(selected.countryCode, selected.id);
    if (!mounted) return;
    setState(() {
      _countryCode = selected.countryCode;
      _operators = operators;
      _operator = selected;
      _products = products;
      _product = null;
      _quote = null;
    });
  });

  Future<void> _review() => _run(() async {
    final product = _product;
    final operator = _operator;
    if (product == null || operator == null) return;
    final amount = product.amountType == 'RANGE'
        ? double.tryParse(_customAmount.text)
        : null;
    final quote = await ref
        .read(mobileTopUpServiceProvider)
        .quote(
          countryCode: operator.countryCode,
          phone: _phone.text,
          operatorId: operator.id,
          productId: product.id,
          amount: amount,
        );
    if (mounted) setState(() => _quote = quote);
  });

  String _key() {
    final random = Random.secure().nextInt(1 << 32).toRadixString(16);
    return 'mobile-topup-${DateTime.now().microsecondsSinceEpoch}-$random';
  }

  Future<void> _purchase() => _run(() async {
    final quote = _quote;
    if (quote == null) return;
    String? recipientId;
    if (_nickname.text.trim().isNotEmpty) {
      final saved = await ref
          .read(mobileTopUpServiceProvider)
          .saveRecipient(
            nickname: _nickname.text.trim(),
            phone: quote.phone,
            countryCode: quote.countryCode,
            operator: _operator,
          );
      recipientId = saved.id;
    }
    final transaction = await ref
        .read(mobileTopUpServiceProvider)
        .purchase(
          quoteId: quote.id,
          idempotencyKey: _key(),
          recipientId: recipientId,
        );
    ref.invalidate(mobileTopUpHistoryProvider);
    ref.invalidate(mobileTopUpRecipientsProvider);
    if (mounted) {
      setState(() {
        _receipt = transaction;
        _quote = null;
      });
    }
  });

  void _reset() => setState(() {
    _clearRechargeState(clearPhone: true, clearNickname: true);
  });

  void _setCountryCode(String value) => setState(() {
    _countryCode = value;
    _clearRechargeState(clearPhone: true, clearNickname: true);
  });

  @override
  Widget build(BuildContext context) {
    final availability = ref.watch(mobileTopUpAvailabilityProvider);
    final rechargeStatus = availability.asData?.value;
    final showSafetyWarning = rechargeStatus?.requiresSafetyWarning ?? true;
    final warningText = rechargeStatus?.environment.toUpperCase() == 'SANDBOX'
        ? 'SANDBOX · Test transactions only — no real airtime or data is purchased.'
        : 'TEST MODE · Mobile Recharge is not approved for live transactions.';
    return Scaffold(
      appBar: AppBar(title: const Text('Mobile Recharge')),
      body: Column(
        children: [
          if (showSafetyWarning)
            Container(
              width: double.infinity,
              color: const Color(0xFFFFF4D6),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              child: Row(
                children: [
                  const Icon(
                    Icons.science_outlined,
                    color: AppTheme.navy,
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      warningText,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 6),
            child: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                  value: false,
                  icon: Icon(Icons.phone_android),
                  label: Text('Recharge'),
                ),
                ButtonSegment(
                  value: true,
                  icon: Icon(Icons.receipt_long_outlined),
                  label: Text('History'),
                ),
              ],
              selected: {_history},
              onSelectionChanged: (value) =>
                  setState(() => _history = value.first),
            ),
          ),
          Expanded(
            child: availability.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, __) => _TopUpUnavailable(
                message: 'The TiCash API could not load Mobile Recharge.',
                onRetry: () => ref.invalidate(mobileTopUpAvailabilityProvider),
              ),
              data: (status) => !status.enabled
                  ? _TopUpUnavailable(
                      message:
                          'Mobile Recharge Sandbox is not configured yet. Add backend-only Reloadly Sandbox credentials to enable it.',
                      onRetry: () =>
                          ref.invalidate(mobileTopUpAvailabilityProvider),
                    )
                  : _history
                  ? _History(
                      onRepeat: (item) async {
                        final quote = await ref
                            .read(mobileTopUpServiceProvider)
                            .repeat(item.id);
                        if (mounted) {
                          setState(() {
                            _history = false;
                            _countryCode = quote.countryCode;
                            _clearRechargeState(clearNickname: true);
                            _quote = quote;
                            _phone.text = quote.phone;
                            _operator = MobileTopUpOperator(
                              id: quote.operatorId,
                              name: quote.operatorName,
                              countryCode: quote.countryCode,
                              bundle: quote.kind == MobileTopUpKind.data,
                            );
                            _product = null;
                            _receipt = null;
                            _error = null;
                          });
                        }
                      },
                    )
                  : _recharge(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _recharge() {
    if (_receipt != null) {
      return _Receipt(
        transaction: _receipt!,
        onAnother: _reset,
        onRefresh: () => _run(() async {
          final updated = await ref
              .read(mobileTopUpServiceProvider)
              .transaction(_receipt!.id, refresh: true);
          if (mounted) setState(() => _receipt = updated);
        }),
      );
    }
    final countries = ref.watch(mobileTopUpCountriesProvider);
    final savedRecipients = ref.watch(mobileTopUpRecipientsProvider);
    return countries.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => _TopUpUnavailable(
        message: 'The TiCash API could not load supported recharge countries.',
        onRetry: () => ref.invalidate(mobileTopUpCountriesProvider),
      ),
      data: (countries) {
        if (countries.isEmpty) {
          return _TopUpUnavailable(
            message:
                'The recharge provider did not return any supported countries.',
            onRetry: () => ref.invalidate(mobileTopUpCountriesProvider),
          );
        }
        final selectedCountryCode =
            countries.any((item) => item.code == _countryCode)
                ? _countryCode!
                : countries.first.code;
        final selectedCountry = countries.firstWhere(
          (item) => item.code == selectedCountryCode,
        );
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 32),
          children: [
            Text(
              'Recharge a phone worldwide',
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            const Text(
              'Send prepaid airtime or a provider-listed data plan to any supported Reloadly Sandbox destination.',
              style: TextStyle(color: AppTheme.muted, height: 1.4),
            ),
            const SizedBox(height: 20),
            savedRecipients.when(
              loading: () => const LinearProgressIndicator(minHeight: 2),
              error: (_, __) => const SizedBox.shrink(),
              data: (items) => items.isEmpty
                  ? const SizedBox.shrink()
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Saved recharge recipients',
                          style: TextStyle(fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 8),
                        SizedBox(
                          height: 44,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: items.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(width: 8),
                            itemBuilder: (context, index) {
                              final recipient = items[index];
                              return ActionChip(
                                avatar: const Icon(
                                  Icons.person_outline,
                                  size: 18,
                                ),
                                label: Text(
                                  '${recipient.nickname} · ${recipient.countryCode}',
                                ),
                                onPressed: () {
                                  setState(() {
                                    _countryCode = recipient.countryCode;
                                    _clearRechargeState();
                                    _phone.text = recipient.phone;
                                    _nickname.text = recipient.nickname;
                                  });
                                  _detect(recipient.countryCode);
                                },
                              );
                            },
                          ),
                        ),
                        const SizedBox(height: 14),
                      ],
                    ),
            ),
            DropdownButtonFormField<String>(
              key: ValueKey(selectedCountryCode),
              value: selectedCountryCode,
              decoration: const InputDecoration(
                labelText: 'Destination country',
                prefixIcon: Icon(Icons.public_outlined),
              ),
              items: countries
                  .map(
                    (item) => DropdownMenuItem(
                      value: item.code,
                      child: Text('${item.name} (${item.code})'),
                    ),
                  )
                  .toList(),
              onChanged: (value) {
                if (value != null && value != selectedCountryCode) {
                  _setCountryCode(value);
                }
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'Mobile number',
                helperText:
                    'Include the full international number for ${selectedCountry.name}',
                prefixIcon: const Icon(Icons.phone_outlined),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _busy || _phone.text.trim().isEmpty
                  ? null
                  : () => _detect(selectedCountry.code),
              icon: const Icon(Icons.search),
              label: const Text('Detect operator'),
            ),
        if (_operators.length > 1) ...[
          const SizedBox(height: 12),
          DropdownButtonFormField<MobileTopUpOperator>(
            initialValue: _operator,
            decoration: const InputDecoration(labelText: 'Operator'),
            items: _operators
                .map(
                  (item) =>
                      DropdownMenuItem(value: item, child: Text(item.name)),
                )
                .toList(),
            onChanged: (value) {
              if (value != null) {
                setState(() => _operator = value);
                _run(() async {
                  final items = await ref
                      .read(mobileTopUpServiceProvider)
                      .products(value.countryCode, value.id);
                  if (mounted) {
                    setState(() {
                      _products = items;
                      _product = null;
                    });
                  }
                });
              }
            },
          ),
        ],
        if (_operator != null) ...[
          const SizedBox(height: 20),
          _InfoRow(
            icon: Icons.sim_card_outlined,
            label: 'Detected operator',
            value: _operator!.name,
          ),
          const SizedBox(height: 18),
          Text(
            'Available airtime & plans',
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 10),
          if (_products.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(18),
                child: Text(
                  'No products are currently returned by the provider.',
                ),
              ),
            ),
          ..._products.map(
            (item) => Card(
              child: ListTile(
                selected: _product?.id == item.id,
                onTap: () => setState(() {
                  _product = item;
                  _quote = null;
                }),
                title: Text(
                  item.name,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: Text(
                  item.kind == MobileTopUpKind.data
                      ? 'Internet / data plan'
                      : 'Prepaid airtime',
                ),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      item.amountType == 'RANGE'
                          ? '${item.minimumAmount}-${item.maximumAmount} ${item.priceCurrency}'
                          : '${item.price.toStringAsFixed(2)} ${item.priceCurrency}',
                      style: const TextStyle(
                        color: AppTheme.navy,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (_product?.id == item.id)
                      const Icon(
                        Icons.check_circle,
                        color: AppTheme.success,
                        size: 18,
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
        if (_product?.amountType == 'RANGE') ...[
          const SizedBox(height: 10),
          TextField(
            controller: _customAmount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: 'Recharge amount (${_product!.priceCurrency})',
            ),
          ),
        ],
        if (_product != null) ...[
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: _busy ? null : _review,
            icon: const Icon(Icons.fact_check_outlined),
            label: const Text('Review recharge'),
          ),
        ],
        if (_quote != null) ...[
          const SizedBox(height: 20),
          _ReviewCard(quote: _quote!),
          const SizedBox(height: 12),
          TextField(
            controller: _nickname,
            decoration: const InputDecoration(
              labelText: 'Save recipient nickname (optional)',
              prefixIcon: Icon(Icons.bookmark_outline),
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _busy ? null : _purchase,
            icon: const Icon(Icons.lock_outline),
            label: const Text('Confirm sandbox recharge'),
          ),
        ],
        if (_busy)
          const Padding(
            padding: EdgeInsets.only(top: 18),
            child: LinearProgressIndicator(),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Text(
              _error!,
              style: const TextStyle(
                color: AppTheme.error,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          ],
        );
      },
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppTheme.border),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Row(
      children: [
        Icon(icon, color: AppTheme.gold),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              Text(value, style: const TextStyle(fontWeight: FontWeight.w900)),
            ],
          ),
        ),
      ],
    ),
  );
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.quote});
  final MobileTopUpQuote quote;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Review',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
          ),
          const Divider(height: 24),
          _line('Country', quote.countryCode),
          _line('Phone', quote.phone),
          _line('Operator', quote.operatorName),
          _line('Product', quote.productName),
          _line(
            'Recharge price',
            '${quote.providerAmount.toStringAsFixed(2)} ${quote.providerCurrency}',
          ),
          _line('TiCash fee', '\$${quote.feeUsd.toStringAsFixed(2)} USD'),
          _line(
            'Total charged',
            '\$${quote.totalChargeUsd.toStringAsFixed(2)} USD',
            strong: true,
          ),
          if (quote.deliveredValue != null)
            _line(
              'Expected delivered value',
              '${quote.deliveredValue!.toStringAsFixed(2)} ${quote.deliveredCurrency}',
            ),
          const SizedBox(height: 8),
          Text(
            'Quote expires ${quote.expiresAt.toLocal()}',
            style: const TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
        ],
      ),
    ),
  );
  static Widget _line(String label, String value, {bool strong = false}) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(label, style: const TextStyle(color: AppTheme.muted)),
            ),
            const SizedBox(width: 12),
            Flexible(
              child: Text(
                value,
                textAlign: TextAlign.right,
                style: TextStyle(
                  fontWeight: strong ? FontWeight.w900 : FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      );
}

class _Receipt extends StatelessWidget {
  const _Receipt({
    required this.transaction,
    required this.onAnother,
    required this.onRefresh,
  });
  final MobileTopUpTransaction transaction;
  final VoidCallback onAnother;
  final VoidCallback onRefresh;
  @override
  Widget build(BuildContext context) {
    final delivered = transaction.status == MobileTopUpStatus.delivered;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Icon(
          delivered ? Icons.check_circle : Icons.schedule,
          size: 66,
          color: delivered ? AppTheme.success : AppTheme.gold,
        ),
        const SizedBox(height: 12),
        Text(
          delivered
              ? 'Recharge delivered'
              : 'Recharge ${transaction.status.name}',
          textAlign: TextAlign.center,
          style: Theme.of(
            context,
          ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 6),
        const Text(
          'Sandbox receipt — no real airtime or data was purchased.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppTheme.muted),
        ),
        const SizedBox(height: 20),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                _ReviewCard._line('TiCash reference', transaction.id),
                _ReviewCard._line(
                  'Country',
                  transaction.countryCode ?? 'Unknown',
                ),
                _ReviewCard._line('Phone', transaction.phone),
                _ReviewCard._line('Operator', transaction.operatorName),
                _ReviewCard._line('Product', transaction.productName),
                _ReviewCard._line(
                  'Price',
                  '${transaction.providerAmount.toStringAsFixed(2)} ${transaction.providerCurrency}',
                ),
                _ReviewCard._line(
                  'Fee',
                  '\$${transaction.feeUsd.toStringAsFixed(2)} USD',
                ),
                _ReviewCard._line(
                  'Total',
                  '\$${transaction.totalChargeUsd.toStringAsFixed(2)} USD',
                  strong: true,
                ),
                _ReviewCard._line(
                  'Status',
                  transaction.status.name.toUpperCase(),
                ),
                _ReviewCard._line(
                  'Date',
                  transaction.createdAt.toLocal().toString(),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        if (!delivered && transaction.status != MobileTopUpStatus.failed)
          OutlinedButton.icon(
            onPressed: onRefresh,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh provider status'),
          ),
        FilledButton(
          onPressed: onAnother,
          child: const Text('Recharge another phone'),
        ),
      ],
    );
  }
}

class _History extends ConsumerWidget {
  const _History({required this.onRepeat});
  final Future<void> Function(MobileTopUpTransaction) onRepeat;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref
      .watch(mobileTopUpHistoryProvider)
      .when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Recharge history is unavailable.'),
                TextButton(
                  onPressed: () => ref.invalidate(mobileTopUpHistoryProvider),
                  child: const Text('Try again'),
                ),
              ],
            ),
          ),
        ),
        data: (items) => items.isEmpty
            ? const Center(child: Text('No mobile recharges yet.'))
            : RefreshIndicator(
                onRefresh: () async =>
                    ref.refresh(mobileTopUpHistoryProvider.future),
                child: ListView.separated(
                  padding: const EdgeInsets.all(20),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    final item = items[index];
                    return Card(
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: const Color(0xFFFFF4D6),
                          child: Icon(
                            item.kind == MobileTopUpKind.data
                                ? Icons.wifi
                                : Icons.phone_android,
                            color: AppTheme.navy,
                          ),
                        ),
                        title: Text(
                          item.productName,
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        subtitle: Text(
                          '${item.countryCode ?? 'Unknown'} · ${item.phone} · ${item.status.name.toUpperCase()}',
                        ),
                        trailing: TextButton(
                          onPressed: () => onRepeat(item),
                          child: const Text('Repeat'),
                        ),
                      ),
                    );
                  },
                ),
              ),
      );
}

class _TopUpUnavailable extends StatelessWidget {
  const _TopUpUnavailable({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.phone_disabled_outlined,
            size: 54,
            color: AppTheme.muted,
          ),
          const SizedBox(height: 14),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(height: 1.45),
          ),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Check again'),
          ),
        ],
      ),
    ),
  );
}
