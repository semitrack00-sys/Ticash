import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/routes.dart';
import '../../config/theme.dart';
import '../../localization/app_localizations.dart';
import '../../models/transfer.dart';
import '../../models/user.dart';
import '../../providers/auth_provider.dart';
import '../../providers/recipients_provider.dart';
import '../../providers/transfer_provider.dart';
import '../../services/transfers_service.dart';
import '../../widgets/app_navigation_bar.dart';
import '../../widgets/primary_button.dart';

class TransferScreen extends ConsumerStatefulWidget {
  const TransferScreen({super.key});
  @override
  ConsumerState<TransferScreen> createState() => _TransferScreenState();
}

class _TransferScreenState extends ConsumerState<TransferScreen> {
  static const _currencyNames = {
    'USD': 'US Dollar',
    'CAD': 'Canadian Dollar',
    'EUR': 'Euro',
    'MXN': 'Mexican Peso',
    'BRL': 'Brazilian Real',
    'CLP': 'Chilean Peso',
    'DOP': 'Dominican Peso',
  };
  static const _currencySymbols = {
    'USD': r'$',
    'CAD': r'CA$',
    'EUR': '€',
    'MXN': r'MX$',
    'BRL': r'R$',
    'CLP': r'CLP$',
    'DOP': r'RD$',
  };
  static const _defaultCorridors = [
    SendCorridor(
      sendCountry: 'US',
      sourceCurrency: 'USD',
      receiveCountry: 'HT',
      targetCurrency: 'HTG',
      quoteEnabled: true,
      fundingEnabled: false,
    ),
    SendCorridor(
      sendCountry: 'CA',
      sourceCurrency: 'CAD',
      receiveCountry: 'HT',
      targetCurrency: 'HTG',
      quoteEnabled: true,
      fundingEnabled: false,
    ),
    SendCorridor(
      sendCountry: 'EU',
      sourceCurrency: 'EUR',
      receiveCountry: 'HT',
      targetCurrency: 'HTG',
      quoteEnabled: true,
      fundingEnabled: false,
    ),
    SendCorridor(
      sendCountry: 'MX',
      sourceCurrency: 'MXN',
      receiveCountry: 'HT',
      targetCurrency: 'HTG',
      quoteEnabled: true,
      fundingEnabled: false,
    ),
    SendCorridor(
      sendCountry: 'BR',
      sourceCurrency: 'BRL',
      receiveCountry: 'HT',
      targetCurrency: 'HTG',
      quoteEnabled: true,
      fundingEnabled: false,
    ),
    SendCorridor(
      sendCountry: 'CL',
      sourceCurrency: 'CLP',
      receiveCountry: 'HT',
      targetCurrency: 'HTG',
      quoteEnabled: true,
      fundingEnabled: false,
    ),
    SendCorridor(
      sendCountry: 'DO',
      sourceCurrency: 'DOP',
      receiveCountry: 'HT',
      targetCurrency: 'HTG',
      quoteEnabled: true,
      fundingEnabled: false,
    ),
  ];
  static const _departments = [
    'Artibonite',
    'Centre',
    "Grand'Anse",
    'Nippes',
    'Nord',
    'Nord-Est',
    'Nord-Ouest',
    'Ouest',
    'Sud',
    'Sud-Est',
  ];

  final _amount = TextEditingController();
  final _recipientFirstName = TextEditingController();
  final _recipientMiddleName = TextEditingController();
  final _recipientLastName = TextEditingController();
  final _phone = TextEditingController(text: '+509');
  final _address = TextEditingController();
  final _city = TextEditingController();
  int _step = 0;
  String _department = 'Ouest';
  String _provider = 'MONCASH';
  String _sourceCurrency = 'USD';
  String _sendCountry = 'US';
  String _amountCurrency = 'USD';
  List<SendCorridor> _corridors = _defaultCorridors;
  List<PayoutChoice> _payoutChoices = const [];
  bool _payoutMethodsLoading = true;
  bool _payoutMethodsLoadFailed = false;
  List<FundingSource> _fundingSources = const [];
  String? _fundingSourceId;
  bool _busy = false;
  String? _error;
  TransferQuote? _quote;
  Transfer? _completed;
  late String _idempotencyKey =
      'mobile-${DateTime.now().microsecondsSinceEpoch}';

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadConfiguration);
  }

  Future<void> _loadConfiguration() async {
    final service = ref.read(transfersServiceProvider);
    List<PayoutChoice> payouts = const [];
    var payoutMethodsLoadFailed = false;
    List<FundingSource> sources = const [];
    List<SendCorridor> corridors = const [];
    try {
      payouts = await service.payoutMethods();
    } catch (_) {
      payouts = const [];
      payoutMethodsLoadFailed = true;
    }
    try {
      corridors = await service.corridors();
    } catch (_) {
      corridors = const [];
    }
    try {
      sources = (await service.fundingSources())
          .where((item) => item.status == 'VERIFIED')
          .toList();
    } catch (_) {
      sources = const [];
    }
    if (!mounted) return;
    setState(() {
      _payoutChoices = payouts;
      _payoutMethodsLoading = false;
      _payoutMethodsLoadFailed = payoutMethodsLoadFailed;
      if (corridors.isNotEmpty) {
        _corridors = corridors;
        final selected = corridors.firstWhere(
          (item) => item.sourceCurrency == _sourceCurrency,
          orElse: () => corridors.first,
        );
        _sourceCurrency = selected.sourceCurrency;
        _sendCountry = selected.sendCountry;
        if (_amountCurrency != 'HTG') _amountCurrency = _sourceCurrency;
      }
      if (payouts.isNotEmpty && !payouts.any((item) => item.id == _provider)) {
        _provider = payouts.first.id;
      }
      _fundingSources = sources;
      _fundingSourceId = sources.isEmpty ? null : sources.first.id;
    });
  }

  Map<String, dynamic> get _recipient => {
    'firstName': _recipientFirstName.text.trim(),
    'middleName': _recipientMiddleName.text.trim().isEmpty
        ? null
        : _recipientMiddleName.text.trim(),
    'lastName': _recipientLastName.text.trim(),
    'country': 'HT',
    'phoneNumber': _phone.text.trim(),
    'address': _address.text.trim(),
    'city': _city.text.trim(),
    'department': _department,
    'payoutMethod': _provider,
  };

  String get _recipientFullName => [
    _recipientFirstName.text.trim(),
    if (_recipientMiddleName.text.trim().isNotEmpty)
      _recipientMiddleName.text.trim(),
    _recipientLastName.text.trim(),
  ].join(' ');

  @override
  void dispose() {
    _amount.dispose();
    _recipientFirstName.dispose();
    _recipientMiddleName.dispose();
    _recipientLastName.dispose();
    _phone.dispose();
    _address.dispose();
    _city.dispose();
    super.dispose();
  }

  double? get _amountValue => double.tryParse(_amount.text.trim());

  Future<void> _next() async {
    FocusScope.of(context).unfocus();
    setState(() => _error = null);
    if (_step == 0) {
      final value = _amountValue;
      if (value == null || value <= 0) {
        setState(() => _error = context.tr('amountError'));
        return;
      }
    }
    if (_step == 1) {
      if (_recipientFirstName.text.trim().isEmpty ||
          _recipientLastName.text.trim().isEmpty ||
          !RegExp(r'^\+509\d{8}$').hasMatch(_phone.text.trim()) ||
          _address.text.trim().length < 3 ||
          _city.text.trim().length < 2) {
        setState(() => _error = context.tr('recipientError'));
        return;
      }
    }
    if (_step == 3) {
      if (_sourceCurrency == 'USD' && _fundingSourceId == null) {
        setState(
          () => _error =
              'Add and verify a U.S. bank account in Wallet before continuing.',
        );
        return;
      }
      await _loadQuote();
      return;
    }
    if (_step == 4) {
      await _submitTransfer();
      return;
    }
    setState(() => _step += 1);
  }

  Future<void> _loadQuote() async {
    setState(() => _busy = true);
    try {
      final result = await ref
          .read(transfersServiceProvider)
          .quote(
            recipient: _recipient,
            amount: _amountValue!,
            amountCurrency: _amountCurrency,
            sendCountry: _sendCountry,
            sourceCurrency: _sourceCurrency,
          );
      if (mounted) {
        setState(() {
          _quote = result;
          _step = 4;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = context.tr('quoteUnavailable'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitTransfer() async {
    final quote = _quote;
    if (quote == null || !quote.expiresAt.isAfter(DateTime.now())) {
      setState(() => _error = context.tr('quoteUnavailable'));
      return;
    }
    setState(() => _busy = true);
    try {
      final result = await ref
          .read(transfersServiceProvider)
          .create(
            recipient: _recipient,
            amount: _amountValue!,
            quoteId: quote.quoteId,
            idempotencyKey: _idempotencyKey,
            amountCurrency: _amountCurrency,
            sendCountry: _sendCountry,
            sourceCurrency: _sourceCurrency,
          );
      if (_sourceCurrency == 'USD' && _fundingSourceId != null) {
        await ref
            .read(transfersServiceProvider)
            .fundTransfer(
              transferId: result.id,
              fundingSourceId: _fundingSourceId!,
              idempotencyKey: 'fund-$_idempotencyKey',
            );
      }
      final refreshed = await ref.read(transfersServiceProvider).get(result.id);
      ref.invalidate(transferHistoryProvider);
      ref.invalidate(recipientsProvider);
      if (mounted) {
        setState(() {
          _completed = refreshed;
          _step = 5;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = context.tr('transferNotSubmitted'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _back() {
    if (_step == 0) {
      context.go(AppRoutes.home);
    } else if (_step < 5) {
      setState(() {
        _step -= 1;
        _error = null;
      });
    }
  }

  void _startOver() {
    _amount.clear();
    _recipientFirstName.clear();
    _recipientMiddleName.clear();
    _recipientLastName.clear();
    _phone.text = '+509';
    _address.clear();
    _city.clear();
    setState(() {
      _step = 0;
      _quote = null;
      _completed = null;
      _error = null;
      _idempotencyKey = 'mobile-${DateTime.now().microsecondsSinceEpoch}';
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authNotifierProvider).valueOrNull;
    if (user == null || user.kycStatus != KycStatus.approved) {
      return _KycGate(status: user?.kycStatus);
    }
    return Scaffold(
      appBar: AppNavigationBar(
        title: context.tr('sendToHaiti'),
        actions: [
          IconButton(
            tooltip: context.tr('close'),
            onPressed: () => context.go(AppRoutes.home),
            icon: const Icon(Icons.close_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            _Progress(step: _step, labels: _localizedSteps(context)),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 620),
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 220),
                      child: _content(context),
                    ),
                  ),
                ),
              ),
            ),
            if (_step < 5)
              Container(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: AppTheme.border)),
                ),
                child: Row(
                  children: [
                    if (_step > 0) ...[
                      OutlinedButton(
                        onPressed: _busy ? null : _back,
                        child: Text(context.tr('back')),
                      ),
                      const SizedBox(width: 12),
                    ],
                    Expanded(
                      child: PrimaryButton(
                        label: _step == 4
                            ? context.tr('confirmSend')
                            : context.tr('continue'),
                        icon: _step == 4
                            ? Icons.lock_outline_rounded
                            : Icons.arrow_forward_rounded,
                        isLoading: _busy,
                        onPressed: _next,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _content(BuildContext context) {
    final content = switch (_step) {
      0 => _amountStep(context),
      1 => _recipientStep(context),
      2 => _deliveryStep(context),
      3 => _paymentStep(context),
      4 => _reviewStep(context),
      _ => _successStep(context),
    };
    return Column(
      key: ValueKey(_step),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        content,
        if (_error != null) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF1F0),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFFECACA)),
            ),
            child: Row(
              children: [
                const Icon(Icons.error_outline, color: AppTheme.error),
                const SizedBox(width: 10),
                Expanded(child: Text(_error!)),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _heading(BuildContext context, String title, String subtitle) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 7),
          Text(
            subtitle,
            style: const TextStyle(color: AppTheme.muted, height: 1.4),
          ),
          const SizedBox(height: 24),
        ],
      );

  Widget _amountStep(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _heading(context, context.tr('howMuch'), context.tr('amountSubtitle')),
      DropdownButtonFormField<String>(
        initialValue: _sourceCurrency,
        decoration: const InputDecoration(
          labelText: 'Sending currency',
          prefixIcon: Icon(Icons.currency_exchange_rounded),
        ),
        items: _corridors
            .map(
              (corridor) => DropdownMenuItem(
                value: corridor.sourceCurrency,
                child: Text(
                  '${_currencyNames[corridor.sourceCurrency] ?? corridor.sourceCurrency} (${corridor.sourceCurrency})',
                ),
              ),
            )
            .toList(),
        onChanged: (value) {
          if (value == null) return;
          final corridor = _corridors.firstWhere(
            (item) => item.sourceCurrency == value,
          );
          setState(() {
            _sourceCurrency = corridor.sourceCurrency;
            _sendCountry = corridor.sendCountry;
            if (_amountCurrency != 'HTG') _amountCurrency = _sourceCurrency;
            _quote = null;
          });
        },
      ),
      const SizedBox(height: 14),
      Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: AppTheme.navy,
          borderRadius: BorderRadius.circular(20),
        ),
        child: TextField(
          controller: _amount,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: const TextStyle(
            color: Colors.white,
            fontSize: 34,
            fontWeight: FontWeight.w900,
          ),
          decoration: InputDecoration(
            labelText: _amountCurrency == _sourceCurrency
                ? context.tr('youSend')
                : context.tr('recipientGets'),
            prefixText: _amountCurrency == _sourceCurrency
                ? '${_currencySymbols[_sourceCurrency] ?? ''} '
                : '',
            suffixText: _amountCurrency,
            fillColor: const Color(0xFF162A47),
            labelStyle: const TextStyle(color: Color(0xFFCBD5E1)),
            prefixStyle: const TextStyle(color: AppTheme.gold),
            suffixStyle: const TextStyle(color: Color(0xFFCBD5E1)),
          ),
        ),
      ),
      const SizedBox(height: 14),
      SegmentedButton<String>(
        segments: [
          ButtonSegment(
            value: _sourceCurrency,
            label: Text('Enter $_sourceCurrency to send'),
          ),
          const ButtonSegment(
            value: 'HTG',
            label: Text('Enter HTG to receive'),
          ),
        ],
        selected: {_amountCurrency},
        onSelectionChanged: (value) => setState(() {
          _amountCurrency = value.first;
          _quote = null;
        }),
      ),
    ],
  );

  Widget _recipientStep(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _heading(
        context,
        context.tr('whoReceiving'),
        context.tr('recipientLegal'),
      ),
      TextField(
        controller: _recipientFirstName,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(
          labelText: context.tr('firstName'),
          prefixIcon: const Icon(Icons.person_outline),
        ),
      ),
      const SizedBox(height: 14),
      TextField(
        controller: _recipientMiddleName,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(
          labelText: context.tr('middleNameOptional'),
          prefixIcon: const Icon(Icons.person_outline),
        ),
      ),
      const SizedBox(height: 14),
      TextField(
        controller: _recipientLastName,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(
          labelText: context.tr('lastName'),
          prefixIcon: const Icon(Icons.person_outline),
        ),
      ),
      const SizedBox(height: 14),
      TextField(
        controller: _phone,
        keyboardType: TextInputType.phone,
        decoration: InputDecoration(
          labelText: context.tr('haitiPhone'),
          helperText: context.tr('haitiPhoneHelper'),
          prefixIcon: const Icon(Icons.phone_outlined),
        ),
      ),
      const SizedBox(height: 14),
      TextField(
        controller: _address,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(
          labelText: context.tr('streetAddress'),
          prefixIcon: const Icon(Icons.home_outlined),
        ),
      ),
      const SizedBox(height: 14),
      Row(
        children: [
          Expanded(
            child: TextField(
              controller: _city,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(labelText: context.tr('city')),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: _department,
              decoration: InputDecoration(labelText: context.tr('department')),
              items: _departments
                  .map(
                    (item) => DropdownMenuItem(value: item, child: Text(item)),
                  )
                  .toList(),
              onChanged: (value) =>
                  setState(() => _department = value ?? _department),
            ),
          ),
        ],
      ),
    ],
  );

  Widget _deliveryStep(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _heading(
        context,
        context.tr('chooseDelivery'),
        context.tr('deliverySubtitle'),
      ),
      if (_payoutMethodsLoading)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Row(
              children: [
                const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2.5),
                ),
                const SizedBox(width: 14),
                Expanded(child: Text(context.tr('loadingHaitiPayoutMethods'))),
              ],
            ),
          ),
        )
      else if (_payoutMethodsLoadFailed)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(context.tr('payoutMethodsLoadFailed')),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () {
                    setState(() {
                      _payoutMethodsLoading = true;
                      _payoutMethodsLoadFailed = false;
                    });
                    _loadConfiguration();
                  },
                  icon: const Icon(Icons.refresh_rounded),
                  label: Text(context.tr('tryAgain')),
                ),
              ],
            ),
          ),
        )
      else if (_payoutChoices.isEmpty)
        const Card(
          child: Padding(
            padding: EdgeInsets.all(18),
            child: Text('No Haiti payout method is enabled for this sandbox.'),
          ),
        )
      else
        ..._payoutChoices.map(
          (choice) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _DeliveryOption(
              title: '${choice.displayName} • Sandbox',
              subtitle: context.tr('mobileWalletDelivery'),
              selected: _provider == choice.id,
              onTap: () => setState(() => _provider = choice.id),
            ),
          ),
        ),
      const SizedBox(height: 16),
      Text(
        context.tr('availabilityTiming'),
        style: const TextStyle(color: AppTheme.muted, fontSize: 12),
      ),
    ],
  );

  Widget _paymentStep(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      _heading(context, context.tr('payment'), context.tr('paymentSubtitle')),
      if (_sourceCurrency != 'USD')
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Text(
              '$_sourceCurrency quote preview is available in Sandbox. A funding provider for this currency is not connected yet, so no account will be charged.',
            ),
          ),
        )
      else if (_fundingSources.isEmpty)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'No verified U.S. bank account is available. Add and verify one before continuing.',
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => context.go(AppRoutes.wallet),
                  icon: const Icon(Icons.account_balance_outlined),
                  label: const Text('Manage bank accounts'),
                ),
              ],
            ),
          ),
        )
      else
        ..._fundingSources.map(
          (source) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _DeliveryOption(
              title: '${source.name} ••••${source.lastFour}',
              subtitle: 'Dwolla Sandbox ACH funding',
              selected: _fundingSourceId == source.id,
              onTap: () => setState(() => _fundingSourceId = source.id),
            ),
          ),
        ),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.science_outlined,
                color: AppTheme.gold,
                size: 28,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      context.tr('testMode'),
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      context.tr('noCharge'),
                      style: const TextStyle(
                        color: AppTheme.muted,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      '${_amountValue?.toStringAsFixed(2) ?? '0.00'} $_amountCurrency entered',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ],
  );

  Widget _reviewStep(BuildContext context) {
    final quote = _quote;
    if (quote == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading(
          context,
          context.tr('reviewTransfer'),
          context.tr('reviewSubtitle'),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                _reviewRow(context.tr('recipient'), _recipientFullName),
                _reviewRow(context.tr('phone'), _phone.text.trim()),
                _reviewRow(
                  context.tr('delivery'),
                  _provider == 'MONCASH' ? 'MonCash' : 'NatCash',
                ),
                const Divider(height: 28),
                _reviewRow(
                  context.tr('youSend'),
                  '${_currencySymbols[quote.sourceCurrency] ?? ''}${quote.amount.toStringAsFixed(2)} ${quote.sourceCurrency}',
                ),
                _reviewRow(
                  'TiCash fee',
                  '${_currencySymbols[quote.sourceCurrency] ?? ''}${quote.ticashFee.toStringAsFixed(2)} ${quote.sourceCurrency}',
                ),
                _reviewRow(
                  'Funding/provider fee',
                  '${_currencySymbols[quote.sourceCurrency] ?? ''}${quote.providerFundingFee.toStringAsFixed(2)} ${quote.sourceCurrency}',
                ),
                _reviewRow(
                  context.tr('total'),
                  '${_currencySymbols[quote.sourceCurrency] ?? ''}${quote.totalCost.toStringAsFixed(2)} ${quote.sourceCurrency}',
                  strong: true,
                ),
                _reviewRow(
                  context.tr('exchangeRate'),
                  '1 ${quote.sourceCurrency} = ${quote.exchangeRate.toStringAsFixed(4)} HTG',
                ),
                _reviewRow(
                  context.tr('recipientGets'),
                  '${quote.amountReceived.toStringAsFixed(2)} HTG',
                  strong: true,
                ),
                _reviewRow(
                  'Quote expires',
                  quote.expiresAt.toLocal().toString(),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            const Icon(Icons.info_outline, size: 18, color: AppTheme.muted),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                context.tr('testRecordNotice'),
                style: const TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _successStep(BuildContext context) {
    final transfer = _completed!;
    return Column(
      children: [
        const SizedBox(height: 20),
        Container(
          width: 88,
          height: 88,
          decoration: const BoxDecoration(
            color: Color(0xFFE7F6ED),
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.sync_rounded,
            color: Color(0xFF175CD3),
            size: 50,
          ),
        ),
        const SizedBox(height: 22),
        Text(
          'Transfer processing',
          style: Theme.of(
            context,
          ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 8),
        Text(
          transfer.sourceCurrency == 'USD'
              ? 'ACH funding was requested in Dwolla Sandbox. Delivery is shown only after the backend confirms the Haiti mock payout succeeded.'
              : '${transfer.sourceCurrency} funding is not connected. This Sandbox transfer is awaiting a compatible funding provider and no money was charged.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppTheme.muted),
        ),
        const SizedBox(height: 24),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                _reviewRow(
                  context.tr('status'),
                  context.tr(transfer.status.name),
                ),
                _reviewRow(context.tr('reference'), transfer.referenceNumber),
                _reviewRow(
                  context.tr('youSent'),
                  '${_currencySymbols[transfer.sourceCurrency] ?? ''}${transfer.amount.toStringAsFixed(2)} ${transfer.sourceCurrency}',
                ),
                _reviewRow(
                  context.tr('recipientGets'),
                  '${transfer.amountReceived.toStringAsFixed(2)} HTG',
                  strong: true,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 22),
        PrimaryButton(
          label: context.tr('viewTransfers'),
          onPressed: () => context.go(AppRoutes.activity),
        ),
        const SizedBox(height: 10),
        TextButton(
          onPressed: _startOver,
          child: Text(context.tr('sendAnother')),
        ),
      ],
    );
  }

  Widget _reviewRow(String label, String value, {bool strong = false}) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(label, style: const TextStyle(color: AppTheme.muted)),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                value,
                textAlign: TextAlign.right,
                style: TextStyle(
                  color: strong ? AppTheme.navy : AppTheme.ink,
                  fontWeight: strong ? FontWeight.w900 : FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      );

  List<String> _localizedSteps(BuildContext context) => [
    context.tr('amount'),
    context.tr('recipient'),
    context.tr('deliveryStep'),
    context.tr('payment'),
    context.tr('review'),
    context.tr('done'),
  ];
}

class _Progress extends StatelessWidget {
  const _Progress({required this.step, required this.labels});
  final int step;
  final List<String> labels;
  @override
  Widget build(BuildContext context) => Container(
    color: Colors.white,
    padding: const EdgeInsets.fromLTRB(20, 14, 20, 16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: List.generate(labels.length, (index) {
            final active = index <= step;
            return Expanded(
              child: Container(
                height: 4,
                margin: EdgeInsets.only(
                  right: index == labels.length - 1 ? 0 : 5,
                ),
                decoration: BoxDecoration(
                  color: active ? AppTheme.gold : AppTheme.border,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: 10),
        Text(
          context.tr('stepProgress', {
            'current': step + 1,
            'total': labels.length,
            'label': labels[step],
          }),
          style: const TextStyle(
            color: AppTheme.muted,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

class _DeliveryOption extends StatelessWidget {
  const _DeliveryOption({
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(18),
    child: Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: selected ? const Color(0xFFFFF8E7) : Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: selected ? AppTheme.gold : AppTheme.border,
          width: selected ? 2 : 1,
        ),
      ),
      child: Row(
        children: [
          const CircleAvatar(
            backgroundColor: AppTheme.navy,
            foregroundColor: AppTheme.gold,
            child: Icon(Icons.account_balance_wallet_outlined),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                Text(subtitle, style: const TextStyle(color: AppTheme.muted)),
              ],
            ),
          ),
          Icon(
            selected ? Icons.check_circle : Icons.circle_outlined,
            color: selected ? AppTheme.gold : AppTheme.muted,
          ),
        ],
      ),
    ),
  );
}

class _KycGate extends StatelessWidget {
  const _KycGate({required this.status});
  final KycStatus? status;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppNavigationBar(title: context.tr('sendToHaiti')),
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.verified_user_outlined,
                    size: 54,
                    color: AppTheme.gold,
                  ),
                  const SizedBox(height: 18),
                  Text(
                    context.tr('identityRequired'),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    status == KycStatus.pending || status == KycStatus.inReview
                        ? context.tr('identityPending')
                        : context.tr('openIdentityVerification'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppTheme.muted),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: () => context.go(AppRoutes.kyc),
                    child: Text(context.tr('verifyIdentity')),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
