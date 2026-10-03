import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'package:ticash/widgets/mobile_operator_logo.dart';
import 'billing_countries.dart';
import 'checkout_contract.dart';
import 'country_flag.dart';
import 'native_actions.dart';
import 'parity_strings.dart';
import 'phone_country_field.dart';
import 'recharge_journey.dart';

export 'country_flag.dart';

Future<String?> pickCountry(
  BuildContext context,
  List<MobileTopUpCountry> countries,
) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (context) => _CountryPicker(countries),
);

class _CountryPicker extends StatefulWidget {
  const _CountryPicker(this.countries);
  final List<MobileTopUpCountry> countries;
  @override
  State<_CountryPicker> createState() => _CountryPickerState();
}

class _CountryPickerState extends State<_CountryPicker> {
  String query = '';
  @override
  Widget build(BuildContext context) {
    final list = widget.countries
        .where(
          (c) =>
              '${c.name} ${c.code}'.toLowerCase().contains(query.toLowerCase()),
        )
        .toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .65,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                autofocus: true,
                decoration: InputDecoration(
                  labelText: context.ft('search'),
                  prefixIcon: const Icon(Icons.search),
                ),
                onChanged: (v) => setState(() => query = v),
              ),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: list.length,
                itemBuilder: (context, i) {
                  final c = list[i];
                  return ListTile(
                    leading: CountryFlag(c.code),
                    title: Text(c.name),
                    subtitle: Text(c.code),
                    onTap: () => Navigator.pop(context, c.code),
                  );
                },
              ),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.ft('close')),
            ),
          ],
        ),
      ),
    );
  }
}

class RechargeJourneyScreen extends StatefulWidget {
  const RechargeJourneyScreen({
    super.key,
    required this.journey,
    this.initialRecipient,
    this.history = false,
    this.resumeToken,
    this.returnOnly = false,
  });
  final RechargeJourney journey;
  final MobileTopUpRecipient? initialRecipient;
  final bool history;
  final String? resumeToken;
  final bool returnOnly;
  @override
  State<RechargeJourneyScreen> createState() => _RechargeJourneyScreenState();
}

class _RechargeJourneyScreenState extends State<RechargeJourneyScreen>
    with WidgetsBindingObserver {
  final phone = TextEditingController(),
      amount = TextEditingController(),
      promo = TextEditingController(),
      nickname = TextEditingController();
  RechargeJourney get j => widget.journey;
  String? uiError;

  bool get canReturnToDestination =>
      !j.busy &&
      !j.locked &&
      j.step == RechargeStep.result &&
      j.result?.terminal == true;

  void startAnother() {
    if (widget.returnOnly) {
      context.go('/recharge');
    } else {
      j.startAnother();
      phone.text = j.phone;
      amount.text = j.amount;
      nickname.text = j.nickname;
    }
  }

  Future<void> goBack() async {
    if (widget.history) return;
    if (j.canBack) {
      await j.back();
      if (mounted && amount.text != j.amount) amount.text = j.amount;
    } else if (canReturnToDestination) {
      startAnother();
    }
  }

  Future<void> continueDestination() async {
    await j.continueDestination();
    if (mounted && amount.text != j.amount) amount.text = j.amount;
  }

  String? amountErrorText() => switch (j.amountIssue) {
    null || RechargeAmountIssue.empty => null,
    RechargeAmountIssue.invalid => context.ft('amountInvalid'),
    RechargeAmountIssue.belowMinimum => context.ft('amountTooLow', {
      'minimum': money(j.product!.minimumAmount!, j.product!.priceCurrency),
    }),
    RechargeAmountIssue.aboveMaximum => context.ft('amountTooHigh', {
      'maximum': money(j.product!.maximumAmount!, j.product!.priceCurrency),
    }),
    RechargeAmountIssue.precision => context.ft('amountPrecision', {
      'precision': '${j.product!.amountPrecision ?? 2}',
    }),
    RechargeAmountIssue.increment => context.ft('amountIncrement', {
      'increment': money(j.product!.amountIncrement!, j.product!.priceCurrency),
      'minimum': money(j.product!.minimumAmount!, j.product!.priceCurrency),
    }),
  };

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    phone.text = j.phone;
    amount.text = j.amount;
    nickname.text = j.nickname;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      if (widget.resumeToken != null) {
        await j.resume(widget.resumeToken!);
        return;
      }
      if (widget.returnOnly) {
        if (!j.locked && j.result == null && j.error == null) {
          setState(() => uiError = 'resumeUnavailable');
        }
        return;
      }
      final needsInitialization = !j.initialized;
      if (needsInitialization && !j.busy) await j.initialize();
      if (!mounted) return;
      if (!widget.history && !needsInitialization) await j.enterRecharge();
      if (!mounted) return;
      phone.text = j.phone;
      amount.text = j.amount;
      nickname.text = j.nickname;
      if (widget.initialRecipient != null && !j.locked && !j.busy) {
        j.selectRecipient(widget.initialRecipient!);
        phone.text = j.phone;
      }
      if (widget.history) await j.loadHistory();
    });
  }

  @override
  void didUpdateWidget(covariant RechargeJourneyScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.history && !widget.history && !widget.returnOnly) {
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (mounted) {
          await j.enterRecharge();
          if (!mounted) return;
          phone.text = j.phone;
          amount.text = j.amount;
          nickname.text = j.nickname;
        }
      });
    }
    if (widget.resumeToken != null &&
        widget.resumeToken != oldWidget.resumeToken) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) j.resume(widget.resumeToken!);
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && j.locked) j.refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    phone.dispose();
    amount.dispose();
    promo.dispose();
    nickname.dispose();
    super.dispose();
  }

  Future<void> openCheckout() async {
    try {
      await NativeActions.checkout(j.hosted!.url);
    } catch (_) {
      if (mounted) setState(() => uiError = 'requestFailed');
    }
  }

  Widget card(List<Widget> children) => Card(
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    ),
  );
  Widget row(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(context.ft(label))),
        const SizedBox(width: 10),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );
  String money(num value, [String currency = 'USD']) =>
      '${value.toStringAsFixed(2)} $currency';
  String billingCountryName(String? code) {
    if (code == null) return context.ft('billing');
    for (final country in billingCountries) {
      if (country['code'] == code) return country['name']!;
    }
    return code;
  }
  // Translate our shared model's labels, not the provider's product description.
  String productDetail(String value) => value.replaceAllMapped(
    RegExp(
      r'No fixed expiry|\b(Unlimited|DATA|data|MINUTES|minutes|SMS|sms|hours?|days?|weeks?|months?|years?)\b',
    ),
    (m) {
      final word = m[0]!;
      final key = switch (word) {
        'data' => 'DATA',
        'MINUTES' || 'minutes' => 'Minutes',
        'sms' => 'SMS',
        'hour' => 'hours',
        'day' => 'days',
        'week' => 'weeks',
        'month' => 'months',
        'year' => 'years',
        _ => word,
      };
      return context.ft(key);
    },
  );
  Widget button(String label, VoidCallback? action) => Padding(
    padding: const EdgeInsets.only(top: 16),
    child: FilledButton(onPressed: action, child: Text(context.ft(label))),
  );
  Widget destination() {
    return card([
      Text(
        context.ft('destination'),
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 16),
      PhoneCountryField(
        fieldKey: const ValueKey('destination-phone'),
        controller: phone,
        countryCode: j.country,
        textInputAction: TextInputAction.done,
        enabled: !j.busy && !j.locked,
        onChanged: (entry) =>
            j.destination(code: entry.country.code, number: entry.e164),
        onSubmitted: () {
          if (!j.busy && !j.locked) continueDestination();
        },
      ),
      if (j.recipients.isNotEmpty)
        ExpansionTile(
          title: Text(context.ft('saved')),
          children: j.recipients
              .map(
                (r) => ListTile(
                  leading: CountryFlag(r.countryCode),
                  title: Text(r.nickname),
                  subtitle: Text('${r.phone} · ${r.countryCode}'),
                  onTap: j.busy || j.locked
                      ? null
                      : () {
                          j.selectRecipient(r);
                          phone.text = j.phone;
                        },
                ),
              )
              .toList(),
        ),
      button(
        'continue',
        j.busy || j.locked || j.country == null || phone.text.trim().isEmpty
            ? null
            : continueDestination,
      ),
    ]);
  }

  Widget product() {
    final kinds = j.products.map((p) => p.kind.name.toUpperCase()).toSet();
    return card([
      Text(
        context.ft('operatorProduct'),
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 16),
      DropdownButtonFormField<int>(
        isExpanded: true,
        initialValue: j.operator?.id,
        decoration: InputDecoration(labelText: context.ft('operator')),
        items: j.operators
            .map(
              (o) => DropdownMenuItem(
                value: o.id,
                child: Row(
                  children: [
                    MobileOperatorLogo(logoUrl: o.logoUrl),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(o.name, overflow: TextOverflow.ellipsis),
                    ),
                  ],
                ),
              ),
            )
            .toList(),
        onChanged: j.busy || j.locked
            ? null
            : (id) {
                final op = j.operators.firstWhere((o) => o.id == id);
                j.selectOperator(op);
                amount.clear();
              },
      ),
      if (j.operator != null) ...[
        const SizedBox(height: 12),
        Row(
          children: [
            MobileOperatorLogo(logoUrl: j.operator!.logoUrl),
            const SizedBox(width: 10),
            Expanded(child: Text(j.operator!.name)),
          ],
        ),
      ],
      if (j.products.isEmpty && !j.busy)
        Padding(
          padding: const EdgeInsets.all(12),
          child: Text(context.ft('noProducts')),
        ),
      for (final kind in kinds) ...[
        Padding(
          padding: const EdgeInsets.only(top: 16, bottom: 8),
          child: Text(
            context.ft(kind),
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
        for (final p in j.products.where(
          (p) => p.kind.name.toUpperCase() == kind,
        ))
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                backgroundColor: j.product?.id == p.id
                    ? const Color(0xFFE0EEFF)
                    : null,
              ),
              onPressed: j.busy || j.locked
                  ? null
                  : () {
                      j.selectProduct(p);
                      amount.clear();
                    },
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text(p.name)),
                        if (j.product?.id == p.id)
                          const Icon(Icons.check_circle),
                      ],
                    ),
                    if (p.description != null) Text(p.description!),
                    if (p.amountType == 'FIXED')
                      Text(money(p.price, p.priceCurrency)),
                    if (p.amountType == 'RANGE')
                      Text(
                        '${context.ft('minimum')}: ${p.minimumAmount} ${p.priceCurrency} · ${context.ft('maximum')}: ${p.maximumAmount} ${p.priceCurrency}',
                      ),
                    for (final benefit in p.benefits)
                      Text(productDetail(benefit)),
                    if (p.validityLabel != null)
                      Text(productDetail(p.validityLabel!)),
                  ],
                ),
              ),
            ),
          ),
      ],
      if (j.product?.amountType == 'RANGE')
        TextField(
          key: const ValueKey('range-amount'),
          controller: amount,
          enabled: !j.busy && !j.locked,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: context.ft('amount'),
            errorText: amountErrorText(),
            errorMaxLines: 3,
          ),
          onChanged: j.setAmount,
        ),
      const SizedBox(height: 16),
      Container(
        key: const ValueKey('promo-panel'),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFE9F2FF),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFC5DCFF)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              context.ft('havePromo'),
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('promotion-code'),
              controller: promo,
              enabled: !j.busy && !j.locked,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                labelText: context.ft('promo'),
                prefixIcon: const Icon(Icons.local_offer_outlined),
                errorText: j.promotionError == null
                    ? null
                    : context.ft(j.promotionError!),
                errorMaxLines: 3,
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              key: const ValueKey('apply-promo'),
              onPressed: j.busy || j.locked
                  ? null
                  : () => j.applyPromotion(promo.text),
              child: Text(context.ft('apply')),
            ),
            if (j.appliedPromotionLabel != null) ...[
              const SizedBox(height: 8),
              Semantics(
                liveRegion: true,
                child: Text(
                  context.ft('promoSaved', {'name': j.appliedPromotionLabel!}),
                  key: const ValueKey('promo-success'),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              Text(context.ft('promotionApplied')),
            ],
          ],
        ),
      ),
      button('continue', j.canReview ? j.review : null),
    ]);
  }

  Widget review() {
    final q = j.quote!;
    return card([
      Text(
        context.ft('reviewConfirm'),
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      Row(
        children: [
          CountryFlag(q.countryCode),
          const SizedBox(width: 8),
          Text(q.countryCode),
        ],
      ),
      row('phone', q.phone),
      Row(
        children: [
          MobileOperatorLogo(logoUrl: j.operator?.logoUrl),
          const SizedBox(width: 8),
          Expanded(child: Text(q.operatorName)),
        ],
      ),
      row('product', q.productName),
      row('amount', money(q.providerAmount, q.providerCurrency)),
      row(
        'receiver',
        q.deliveredValue == null
            ? context.ft('pendingValue')
            : money(q.deliveredValue!, q.deliveredCurrency),
      ),
      if (j.promotion != null) ...[
        row('promotion', j.promotion!['name']?.toString() ?? ''),
        if (j.promotion!['originalFeeCents'] is num)
          row(
            'originalFee',
            money((j.promotion!['originalFeeCents'] as num) / 100),
          ),
        if (j.promotion!['benefitCents'] is num)
          row('benefit', money((j.promotion!['benefitCents'] as num) / 100)),
        if (j.promotion!['firstRechargeOnly'] == true)
          Text(context.ft('firstRecharge')),
      ],
      row('fee', money(q.feeUsd)),
      const Divider(),
      row('total', money(q.totalChargeUsd)),
      Text('${context.ft('quoteExpiry')}: ${q.expiresAt.toLocal()}'),
      if (!j.quoteValid) Text(context.ft('quoteExpired')),
      const SizedBox(height: 16),
      TextField(
        controller: nickname,
        enabled: !j.busy && !j.locked,
        decoration: InputDecoration(labelText: context.ft('nickname')),
        onChanged: (v) => j.nickname = v,
      ),
      if (j.payments?.mode != CheckoutMode.mock) ...[
        const SizedBox(height: 16),
        Text(context.ft('billingHelp')),
        const SizedBox(height: 8),
        Builder(
          builder: (context) {
            final selected = j.guest()
                ? j.billingCountry
                : j.storedBillingCountry();
            return OutlinedButton(
              key: const ValueKey('billing-country-picker'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
              ),
              onPressed: j.busy || j.locked
                  ? null
                  : () async {
                      final code = await pickCountry(
                        context,
                        billingCountries
                            .map(
                              (c) => MobileTopUpCountry(
                                code: c['code']!,
                                name: c['name']!,
                              ),
                            )
                            .toList(),
                      );
                      if (code == null || j.locked || j.busy) return;
                      try {
                        await j.chooseBillingCountry(code);
                      } catch (_) {
                        if (mounted) setState(() => uiError = 'requestFailed');
                      }
                    },
              child: Row(
                children: [
                  if (selected != null) ...[
                    CountryFlag(selected),
                    const SizedBox(width: 12),
                  ] else ...[
                    const Icon(Icons.public_rounded),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          context.ft('billing'),
                          style: Theme.of(context).textTheme.labelMedium,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          billingCountryName(selected),
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.keyboard_arrow_down_rounded),
                ],
              ),
            );
          },
        ),
      ],
      CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        value: j.reviewed,
        onChanged: j.busy || j.locked
            ? null
            : (v) => j.confirmReview(v ?? false),
        title: Text(context.ft('reviewCheck')),
      ),
      button(
        j.payments?.mode == CheckoutMode.mock
            ? 'mockPay'
            : j.payments?.mode == CheckoutMode.stripeSandbox
            ? 'testPay'
            : 'pay',
        j.canPay
            ? () async {
                await j.pay();
                if (j.hosted != null) await openCheckout();
              }
            : null,
      ),
      if (!j.quoteValid)
        TextButton(
          onPressed: j.busy || j.locked ? null : j.review,
          child: Text(context.ft('retry')),
        ),
    ]);
  }

  Widget payment() => card([
    const Icon(Icons.lock_outline, size: 40),
    Text(
      context.ft('pendingPayment'),
      style: Theme.of(context).textTheme.headlineSmall,
    ),
    Text(context.ft('pendingRecoveryHelp')),
    if (j.hosted != null) button('openCheckout', j.busy ? null : openCheckout),
    if (j.hosted == null && j.result == null)
      button('retrySame', j.busy ? null : j.retryPayment),
    button('refresh', j.busy ? null : j.refresh),
    if (!widget.returnOnly && j.canCancel)
      button(
        'cancelPending',
        j.busy
            ? null
            : () async {
                await j.cancelPending();
                if (mounted && !j.locked) {
                  phone.text = j.phone;
                  amount.text = j.amount;
                  nickname.text = j.nickname;
                }
              },
      ),
    TextButton(
      onPressed: () => context.go('/history'),
      child: Text(context.ft('history')),
    ),
  ]);
  Widget receipt(RechargeResult r, {bool historical = false}) {
    final d = r.data;
    final state =
        [
          'PENDING',
          'PROCESSING',
          'DELIVERED',
          'FAILED',
          'REFUND_PENDING',
          'REFUNDED',
          'VOID_PENDING',
          'VOIDED',
        ].contains(r.displayState)
        ? r.displayState
        : 'unknownState';
    final reason = switch (d['failureReason'] ?? d['failureCode']) {
      'INSUFFICIENT_FUNDS' => 'insufficientFunds',
      'PAYMENT_DECLINED' => 'paymentDeclined',
      'PAYMENT_CANCELLED' || 'CANCELLED_BY_CUSTOMER' => 'paymentCancelled',
      'RECHARGE_PROVIDER_FAILED' || 'TOPUP_PROVIDER_FAILED' => 'providerFailed',
      _ => null,
    };
    return card([
      Text(context.ft(state), style: Theme.of(context).textTheme.headlineSmall),
      if (d['countryCode'] is String)
        Row(
          children: [
            CountryFlag(d['countryCode'] as String),
            const SizedBox(width: 10),
            Text(d['countryCode'] as String),
          ],
        ),
      row('phone', d['recipientPhone']?.toString() ?? ''),
      Row(
        children: [
          MobileOperatorLogo(
            logoUrl:
                j.operator?.name == d['operatorName'] &&
                    j.country == d['countryCode']
                ? j.operator?.logoUrl
                : null,
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(d['operatorName']?.toString() ?? '')),
        ],
      ),
      row('product', d['productName']?.toString() ?? ''),
      row(
        'amount',
        money(
          d['providerAmount'] as num,
          d['providerCurrency']?.toString() ?? 'USD',
        ),
      ),
      row('fee', money(d['feeUsd'] as num)),
      row('total', money(d['totalChargeUsd'] as num)),
      row(
        'receiver',
        r.status == 'DELIVERED' && d['deliveredValue'] is num
            ? money(
                d['deliveredValue'] as num,
                d['deliveredCurrency']?.toString() ?? '',
              )
            : context.ft('unconfirmedValue'),
      ),
      if (d['receiverQuote'] is Map &&
          d['receiverQuote']['amount'] is num &&
          d['receiverQuote']['currency'] is String)
        row(
          'quotedReceiver',
          '${d['receiverQuote']['amount']} ${d['receiverQuote']['currency']}',
        ),
      if (d['receiverDiscrepancy'] == true)
        Text(context.ft('receiverMismatch')),
      if (r.id != null) row('Reference', r.id!),
      if (d['createdAt'] is String &&
          DateTime.tryParse(d['createdAt'] as String) != null)
        row(
          'Updated',
          DateTime.parse(d['createdAt'] as String).toLocal().toString(),
        ),
      if (reason != null) Text(context.ft(reason)),
      if (!r.terminal) Text(context.ft('pendingNotice')),
      if (!historical) button('refresh', j.busy ? null : j.refresh),
      if (!historical && !r.terminal && j.hosted != null)
        button('openCheckout', j.busy ? null : openCheckout),
      if (historical && r.terminal)
        button(
          'repeat',
          j.busy || j.locked
              ? null
              : () async {
                  await j.repeat(r);
                  if (mounted) context.go('/recharge');
                },
        ),
      if (!historical && r.terminal)
        button('another', j.busy || j.locked ? null : startAnother),
      if (!historical)
        TextButton(
          onPressed: () => context.go('/history'),
          child: Text(context.ft('history')),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: j,
    builder: (context, _) => PopScope(
      canPop:
          widget.history ||
          (!j.busy && !j.locked && j.step == RechargeStep.destination),
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) goBack();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(context.ft(widget.history ? 'history' : 'recharge')),
          automaticallyImplyLeading: widget.history,
          leading: !widget.history && j.step != RechargeStep.destination
              ? IconButton(
                  key: const ValueKey('recharge-back'),
                  tooltip: context.ft('back'),
                  icon: const BackButtonIcon(),
                  onPressed: j.canBack || canReturnToDestination
                      ? goBack
                      : null,
                )
              : null,
        ),
        body: SafeArea(
          child: RefreshIndicator(
            onRefresh: widget.history
                ? j.loadHistory
                : () async {
                    if (j.locked) {
                      await j.refresh();
                    } else {
                      await j.initialize();
                    }
                  },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: [
                if (j.payments?.mode == CheckoutMode.mock ||
                    j.payments?.mode == CheckoutMode.stripeSandbox)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      context.ft(
                        j.payments!.mode == CheckoutMode.mock
                            ? 'mockMode'
                            : 'sandboxMode',
                      ),
                    ),
                  ),
                if (j.busy) const LinearProgressIndicator(),
                if (j.error != null || uiError != null)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      context.ft(j.error ?? uiError!),
                      semanticsLabel: context.ft(j.error ?? uiError!),
                    ),
                  ),
                if (j.notice != null &&
                    !(j.notice == 'promotionApplied' &&
                        j.step == RechargeStep.product))
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(context.ft(j.notice!)),
                  ),
                if (!widget.returnOnly &&
                    !j.initialized &&
                    !j.busy &&
                    !j.locked)
                  button('retry', j.initialize),
                if (widget.history) ...[
                  if (j.history.isEmpty) Text(context.ft('emptyHistory')),
                  for (final r in j.history) ...[
                    receipt(r, historical: true),
                    const SizedBox(height: 12),
                  ],
                ] else
                  switch (j.step) {
                    RechargeStep.destination => destination(),
                    RechargeStep.product => product(),
                    RechargeStep.review => review(),
                    RechargeStep.payment => payment(),
                    RechargeStep.recovery => payment(),
                    RechargeStep.result =>
                      j.result == null ? payment() : receipt(j.result!),
                  },
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
