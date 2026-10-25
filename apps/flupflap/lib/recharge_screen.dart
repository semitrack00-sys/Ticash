import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ticash_recharge_core/models/mobile_top_up.dart';
import 'package:ticash_recharge_core/widgets/mobile_operator_logo.dart';

import 'billing_countries.dart';
import 'recharge_design.dart';
import 'flupflap_page_title.dart';
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
    this.initialInternet = false,
    this.history = false,
    this.resumeToken,
    this.returnOnly = false,
  });
  final RechargeJourney journey;
  final MobileTopUpRecipient? initialRecipient;
  final bool initialInternet;
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
  bool _openingCheckout = false;
  Timer? _previewTimer;
  int? _scheduledQuoteRevision;

  void schedulePricePreview() {
    if (widget.history ||
        widget.returnOnly ||
        j.step != RechargeStep.product ||
        !j.canReview) {
      _previewTimer?.cancel();
      _scheduledQuoteRevision = null;
      return;
    }
    if (_scheduledQuoteRevision == j.quoteRevision) return;
    _scheduledQuoteRevision = j.quoteRevision;
    _previewTimer?.cancel();
    _previewTimer = Timer(const Duration(milliseconds: 400), () {
      if (mounted) j.previewQuote();
    });
  }

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
    j.addListener(schedulePricePreview);
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
      if (widget.initialInternet && !widget.history && !j.locked && !j.busy) {
        j.selectService(true);
      }
      if (widget.history) await j.loadHistory();
      schedulePricePreview();
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
    j.removeListener(schedulePricePreview);
    _previewTimer?.cancel();
    phone.dispose();
    amount.dispose();
    promo.dispose();
    nickname.dispose();
    super.dispose();
  }

  Future<void> openCheckout({bool recheck = true}) async {
    if (_openingCheckout || !mounted) return;
    setState(() {
      _openingCheckout = true;
      uiError = null;
    });
    try {
      final uri = recheck ? await j.checkoutForContinuation() : j.hosted?.url;
      if (!mounted || uri == null) return;
      await NativeActions.checkout(uri);
    } catch (_) {
      if (mounted) setState(() => uiError = 'requestFailed');
    } finally {
      if (mounted) setState(() => _openingCheckout = false);
    }
  }

  Widget continuePayment() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(context.ft('bankVerificationHelp')),
      button(
        _openingCheckout ? 'openingPayment' : 'openCheckout',
        j.busy || _openingCheckout ? null : openCheckout,
      ),
      const SizedBox(height: 8),
      Text(context.ft('paymentReturnHelp')),
    ],
  );

  Widget refreshPayment() => TextButton(
    onPressed: j.busy || _openingCheckout ? null : j.refresh,
    child: Text(context.ft('refresh')),
  );

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
    final editable = !j.busy && !j.locked;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(context.ft('operatorProduct'), style: RechargeDesign.title),
        const SizedBox(height: 12),
        RechargeServiceTabs(
          internet: j.internet,
          onChanged: editable
              ? (value) {
                  j.selectService(value);
                  amount.clear();
                }
              : null,
        ),
        const SizedBox(height: 20),
        if (j.serviceOperators.isEmpty && !j.busy)
          Text(context.ft(j.internet ? 'noInternetOperators' : 'noProducts')),
        DropdownButtonFormField<int>(
          key: ValueKey('${j.country}:${j.internet}:${j.operator?.id}'),
          isExpanded: true,
          initialValue: j.operator?.id,
          decoration: RechargeDesign.input(label: context.ft('operator'))
              .copyWith(
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
              ),
          style: const TextStyle(
            fontFamily: 'Roboto',
            color: RechargeDesign.navy,
            fontWeight: FontWeight.w700,
            fontSize: 17,
          ),
          icon: const Icon(
            Icons.keyboard_arrow_down,
            color: RechargeDesign.muted,
          ),
          items: j.serviceOperators
              .map(
                (o) => DropdownMenuItem(
                  value: o.id,
                  child: Row(
                    children: [
                      MobileOperatorLogo(logoUrl: o.logoUrl),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(o.name, overflow: TextOverflow.ellipsis),
                      ),
                    ],
                  ),
                ),
              )
              .toList(),
          onChanged: !editable
              ? null
              : (id) {
                  if (id == null) return;
                  j.selectOperator(
                    j.serviceOperators.firstWhere((o) => o.id == id),
                  );
                  amount.clear();
                },
        ),
        const SizedBox(height: 12),
        if (j.products.isEmpty && !j.busy && j.serviceOperators.isNotEmpty)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(context.ft('noProducts')),
          ),
        for (final p in j.products)
          RechargeProductCard(
            product: p,
            selected: j.product?.id == p.id,
            operatorName: j.operator?.name,
            logoUrl: j.operator?.logoUrl,
            detailLabel: productDetail,
            onSelected: !editable
                ? null
                : () {
                    // Tapping the already selected card must not erase an entered amount.
                    if (j.product?.id != p.id) {
                      j.selectProduct(p);
                      amount.clear();
                    }
                  },
          ),
        if (j.product?.amountType == 'RANGE') ...[
          const SizedBox(height: 4),
          RechargeAmountField(
            product: j.product!,
            controller: amount,
            enabled: editable,
            errorText: amountErrorText(),
            onChanged: j.setAmount,
          ),
        ],
        const SizedBox(height: 12),
        Container(
          key: const ValueKey('promo-panel'),
          decoration: const BoxDecoration(
            color: RechargeDesign.paleBlue,
            borderRadius: RechargeDesign.radius,
          ),
          child: ExpansionTile(
            key: const ValueKey('recharge-promotion'),
            shape: const Border(),
            collapsedShape: const Border(),
            iconColor: RechargeDesign.navy,
            collapsedIconColor: RechargeDesign.navy,
            leading: const Icon(
              Icons.local_offer_outlined,
              color: RechargeDesign.navy,
            ),
            title: Text(
              context.ft('havePromo'),
              style: RechargeDesign.title.copyWith(fontSize: 16),
            ),
            subtitle: j.appliedPromotionLabel == null
                ? null
                : Text(
                    context.ft('promoSaved', {
                      'name': j.appliedPromotionLabel!,
                    }),
                    key: const ValueKey('promo-success'),
                  ),
            childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
            children: [
              TextField(
                key: const ValueKey('promotion-code'),
                controller: promo,
                enabled: editable,
                textCapitalization: TextCapitalization.characters,
                decoration: RechargeDesign.input(label: context.ft('promo'))
                    .copyWith(
                      errorText: j.promotionError == null
                          ? null
                          : context.ft(j.promotionError!),
                      errorMaxLines: 3,
                    ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  key: const ValueKey('apply-promo'),
                  onPressed: !editable
                      ? null
                      : () => j.applyPromotion(promo.text),
                  child: Text(context.ft('apply')),
                ),
              ),
              if (j.appliedPromotionLabel != null)
                Text(context.ft('promotionApplied')),
            ],
          ),
        ),
        const SizedBox(height: 12),
        RechargePriceSummary(
          quote: j.quoteValid ? j.quote : null,
          loading: j.previewBusy,
          message: j.previewError != null
              ? context.ft(j.previewError!)
              : j.quote != null && !j.quoteValid
              ? context.ft('quoteExpired')
              : null,
          onRetry:
              editable &&
                  (j.previewError != null || j.quote != null && !j.quoteValid)
              ? j.previewQuote
              : null,
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            key: const ValueKey('continue-to-payment'),
            style: FilledButton.styleFrom(
              backgroundColor: RechargeDesign.navy,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 52),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              shape: const RoundedRectangleBorder(
                borderRadius: RechargeDesign.radius,
              ),
            ),
            onPressed: j.canReview ? j.review : null,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Flexible(
                  child: Text(
                    context.ft('continueToPayment'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 17,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                const Icon(Icons.arrow_forward),
              ],
            ),
          ),
        ),
      ],
    );
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
      if (!j.guest() &&
          j.availability?.recurringRechargeEnabled == true &&
          j.payments?.mode != CheckoutMode.mock) ...[
        const SizedBox(height: 18),
        Text(
          context.ft('recurringTitle'),
          style: Theme.of(context).textTheme.titleMedium
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(context.ft('recurringReviewHelp')),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            ChoiceChip(
              label: Text(context.ft('recurringOff')),
              selected: j.recurringIntervalDays == null,
              onSelected: j.busy || j.locked
                  ? null
                  : (_) => j.setRecurringInterval(null),
            ),
            for (final days in [7, 15, 30])
              ChoiceChip(
                key: ValueKey('recurring-choice-$days'),
                label: Text(context.ft('everyDays', {'days': days.toString()})),
                selected: j.recurringIntervalDays == days,
                onSelected: j.busy || j.locked
                    ? null
                    : (_) => j.setRecurringInterval(days),
              ),
          ],
        ),
        if (j.recurringIntervalDays != null) ...[
          const SizedBox(height: 8),
          Text(
            context.ft('recurringConsent', {
              'days': j.recurringIntervalDays.toString(),
            }),
          ),
        ],
      ],
      CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        value: j.reviewed,
        onChanged: j.busy || j.locked
            ? null
            : (v) => j.confirmReview(v ?? false),
        title: Text(context.ft('reviewCheck')),
      ),
      if (j.payments?.mode != CheckoutMode.mock)
        Text(context.ft('bankVerificationHelp')),
      button(
        j.payments?.mode == CheckoutMode.mock
            ? 'mockPay'
            : j.payments?.mode == CheckoutMode.stripeSandbox
            ? 'testPay'
            : 'pay',
        j.canPay
            ? () async {
                await j.pay();
                if (j.hosted != null) await openCheckout(recheck: false);
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
    if (j.canContinueCheckout)
      continuePayment()
    else
      Text(context.ft('pendingRecoveryHelp')),
    if (j.hosted == null && j.result == null)
      button('retrySame', j.busy ? null : j.retryPayment),
    refreshPayment(),
    if (!widget.returnOnly && j.canCancel)
      button(
        'cancelPending',
        j.busy || _openingCheckout
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
    final recurring = r.id == null ? null : j.recurringFor(r.id!);
    final reason = switch (d['failureReason'] ?? d['failureCode']) {
      'INSUFFICIENT_FUNDS' => 'insufficientFunds',
      'PAYMENT_DECLINED' => 'paymentDeclined',
      'PAYMENT_CANCELLED' || 'CANCELLED_BY_CUSTOMER' => 'paymentCancelled',
      'RECHARGE_PROVIDER_FAILED' || 'TOPUP_PROVIDER_FAILED' => 'providerFailed',
      _ => null,
    };
    return card([
      Text(
        (d['reviewRequired'] == true ||
                d['failureCode'] == 'FRAUD_REVIEW_REQUIRED')
            ? context.ft('paymentUnderReview')
            : context.ft(state),
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      if (d['reviewRequired'] == true ||
          d['failureCode'] == 'FRAUD_REVIEW_REQUIRED')
        Text(context.ft('paymentUnderReviewHelp')),
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
      if (r.status == 'DELIVERED' &&
          r.paymentStatus == 'CAPTURED' &&
          r.id != null &&
          !j.guest() &&
          j.availability?.recurringRechargeEnabled == true &&
          (recurring != null || d['recurringIntervalDays'] is int)) ...[
        const Divider(),
        Text(
          context.ft('recurringTitle'),
          style: Theme.of(context).textTheme.titleMedium
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        if (recurring == null)
          Text(context.ft('recurringSetupPending'))
        else ...[
          row(
            'recurringFrequency',
            context.ft('everyDays', {
              'days': recurring.intervalDays.toString(),
            }),
          ),
          row('recurringNext', recurring.nextRunAt.toLocal().toString()),
          Text(context.ft('recurringStatus${recurring.status}')),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (recurring.status == 'ACTIVE')
                OutlinedButton(
                  onPressed: j.busy
                      ? null
                      : () => j.updateRecurring(recurring.id, 'PAUSE'),
                  child: Text(context.ft('recurringPause')),
                ),
              if (recurring.status == 'PAUSED')
                FilledButton.tonal(
                  onPressed: j.busy
                      ? null
                      : () => j.updateRecurring(recurring.id, 'RESUME'),
                  child: Text(context.ft('recurringResume')),
                ),
              OutlinedButton(
                onPressed: j.busy
                    ? null
                    : () => j.updateRecurring(recurring.id, 'CANCEL'),
                child: Text(context.ft('recurringCancel')),
              ),
            ],
          ),
        ],
      ],
      if (!r.terminal) Text(context.ft('pendingNotice')),
      if (!historical && !r.terminal && j.canContinueCheckout)
        continuePayment(),
      if (!historical) refreshPayment(),
      if (historical && r.terminal && r.id != null)
        TextButton.icon(
          key: ValueKey('receipt-delete-${r.id}'),
          icon: const Icon(Icons.delete_outline),
          label: Text(context.ft('Delete receipt')),
          onPressed: j.busy
              ? null
              : () async {
                  final confirmed = await showDialog<bool>(
                    context: context,
                    builder: (dialogContext) => AlertDialog(
                      title: Text(context.ft('Delete receipt')),
                      content: Text(
                        context.ft(
                          'This removes the receipt from your history.',
                        ),
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(dialogContext, false),
                          child: Text(context.ft('Cancel')),
                        ),
                        FilledButton(
                          onPressed: () => Navigator.pop(dialogContext, true),
                          child: Text(context.ft('Delete')),
                        ),
                      ],
                    ),
                  );
                  if (confirmed == true && r.id != null) {
                    await j.client.removeReceipt(r.id!);
                    await j.loadHistory();
                  }
                },
        ),
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
        backgroundColor: j.step == RechargeStep.product ? Colors.white : null,
        appBar: AppBar(
          backgroundColor: !widget.history ? RechargeDesign.navy : null,
          foregroundColor: !widget.history ? Colors.white : null,
          titleTextStyle: !widget.history
              ? const TextStyle(
                  fontFamily: 'Roboto',
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                )
              : null,
          surfaceTintColor: j.step == RechargeStep.product
              ? Colors.transparent
              : null,
          title: FlupFlapPageTitle(
            context.ft(widget.history ? 'history' : 'recharge'),
            onNavy: !widget.history,
          ),
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
