import 'package:flutter/material.dart';
import 'package:ticash_recharge_core/models/mobile_top_up.dart';
import 'package:ticash_recharge_core/widgets/mobile_operator_logo.dart';

import 'parity_strings.dart';

/// Shared presentation for every country. Catalog values and server quotes are
/// the only sources of prices, limits, benefits and fees.
abstract final class RechargeDesign {
  static const navy = Color(0xFF082F60);
  static const border = Color(0xFFD8DDE4);
  static const muted = Color(0xFF596171);
  static const paleBlue = Color(0xFFEAF2FD);
  static const radius = BorderRadius.all(Radius.circular(10));
  static const title = TextStyle(
    color: navy,
    fontSize: 20,
    fontWeight: FontWeight.w800,
  );

  static String number(num amount) => amount == amount.roundToDouble()
      ? amount.toStringAsFixed(0)
      : amount.toStringAsFixed(2);
  static String symbol(String currency) => switch (currency) {
    'USD' => '\$',
    'EUR' => '€',
    'GBP' => '£',
    _ => currency,
  };
  static String limit(num amount, String currency) =>
      '${symbol(currency)}${symbol(currency) == currency ? ' ' : ''}${number(amount)}';
  static double textWidth(BuildContext context, String text, TextStyle style) =>
      (TextPainter(
        text: TextSpan(
          text: text,
          style: DefaultTextStyle.of(context).style.merge(style),
        ),
        textDirection: Directionality.of(context),
        textScaler: MediaQuery.textScalerOf(context),
      )..layout()).width;
  static String money(num amount, String currency) =>
      '${currency == 'USD' ? '\$' : ''}${amount.toStringAsFixed(2)} $currency';
  static InputDecoration input({String? label}) => InputDecoration(
    labelText: label,
    labelStyle: const TextStyle(color: muted),
    border: const OutlineInputBorder(
      borderRadius: radius,
      borderSide: BorderSide(color: border),
    ),
    enabledBorder: const OutlineInputBorder(
      borderRadius: radius,
      borderSide: BorderSide(color: border),
    ),
    focusedBorder: const OutlineInputBorder(
      borderRadius: radius,
      borderSide: BorderSide(color: navy, width: 1.5),
    ),
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
  );
}

class RechargeServiceTabs extends StatelessWidget {
  const RechargeServiceTabs({
    super.key,
    required this.internet,
    required this.onChanged,
  });
  final bool internet;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final stacked =
          constraints.maxWidth < 300 ||
          MediaQuery.textScalerOf(context).scale(14) > 22;
      Widget tab(bool value) {
        final active = internet == value;
        final foreground = active ? Colors.white : RechargeDesign.muted;
        return Semantics(
          selected: active,
          button: true,
          child: Material(
            color: active ? RechargeDesign.navy : Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: RechargeDesign.radius,
              side: BorderSide(
                color: active ? RechargeDesign.navy : RechargeDesign.border,
              ),
            ),
            child: InkWell(
              key: ValueKey('recharge-service-$value'),
              borderRadius: RechargeDesign.radius,
              onTap: onChanged == null ? null : () => onChanged!(value),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 10,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        value ? Icons.language : Icons.phone,
                        size: 20,
                        color: foreground,
                      ),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          context.ft(value ? 'internetBundles' : 'AIRTIME'),
                          textAlign: TextAlign.center,
                          softWrap: true,
                          style: TextStyle(
                            color: foreground,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      }

      if (stacked) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [tab(false), const SizedBox(height: 8), tab(true)],
        );
      }
      return IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: tab(false)),
            const SizedBox(width: 10),
            Expanded(child: tab(true)),
          ],
        ),
      );
    },
  );
}

class RechargeProductCard extends StatelessWidget {
  const RechargeProductCard({
    super.key,
    required this.product,
    required this.selected,
    required this.onSelected,
    required this.detailLabel,
    this.operatorName,
    this.logoUrl,
  });
  final MobileTopUpProduct product;
  final bool selected;
  final VoidCallback? onSelected;
  final String Function(String) detailLabel;
  final String? operatorName, logoUrl;

  @override
  Widget build(BuildContext context) {
    final range = product.amountType == 'RANGE';
    final kind = context.ft(
      product.kind == MobileTopUpKind.airtime ? 'AIRTIME' : 'bundlePlan',
    );
    final name = product.name.trim();
    final showName =
        name.isNotEmpty &&
        name.toLowerCase() != operatorName?.trim().toLowerCase() &&
        name.toLowerCase() != kind.toLowerCase();
    Widget details() => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          range
              ? kind
              : showName
              ? name
              : kind,
          style: const TextStyle(
            color: RechargeDesign.navy,
            fontWeight: FontWeight.w800,
            fontSize: 18,
          ),
        ),
        if (range && showName)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              name,
              style: const TextStyle(color: RechargeDesign.muted, fontSize: 14),
            ),
          ),
        if (product.validityLabel != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              detailLabel(product.validityLabel!),
              style: const TextStyle(color: RechargeDesign.muted),
            ),
          ),
      ],
    );
    Widget price() => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (range) ...[
          Text(
            '${context.ft('minimum')}: ${RechargeDesign.limit(product.minimumAmount!, product.priceCurrency)}',
            style: const TextStyle(color: RechargeDesign.muted, fontSize: 14),
          ),
          Text(
            '${context.ft('maximum')}: ${RechargeDesign.limit(product.maximumAmount!, product.priceCurrency)}',
            style: const TextStyle(color: RechargeDesign.muted, fontSize: 14),
          ),
        ] else
          Text(
            '${product.priceCurrency == 'USD' ? '\$' : ''}${product.price.toStringAsFixed(2)}',
            style: const TextStyle(
              color: RechargeDesign.navy,
              fontWeight: FontWeight.w800,
              fontSize: 21,
            ),
          ),
        Text(
          product.priceCurrency,
          style: const TextStyle(color: RechargeDesign.muted, fontSize: 12),
        ),
      ],
    );
    return Semantics(
      selected: selected,
      button: true,
      child: Container(
        key: ValueKey('bundle-card-${product.id}'),
        margin: const EdgeInsets.only(bottom: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: RechargeDesign.radius,
          border: Border.all(
            color: selected ? RechargeDesign.navy : RechargeDesign.border,
          ),
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: RechargeDesign.radius,
          child: InkWell(
            key: ValueKey('bundle-buy-${product.id}'),
            onTap: onSelected,
            borderRadius: RechargeDesign.radius,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final priceWidth = range
                          ? [product.minimumAmount!, product.maximumAmount!]
                                .map(
                                  (amount) => RechargeDesign.textWidth(
                                    context,
                                    '${context.ft(amount == product.minimumAmount ? 'minimum' : 'maximum')}: ${RechargeDesign.limit(amount, product.priceCurrency)}',
                                    const TextStyle(fontSize: 14),
                                  ),
                                )
                                .reduce((a, b) => a > b ? a : b)
                          : RechargeDesign.textWidth(
                              context,
                              '${product.priceCurrency == 'USD' ? '\$' : ''}${product.price.toStringAsFixed(2)}',
                              const TextStyle(
                                fontSize: 21,
                                fontWeight: FontWeight.w800,
                              ),
                            );
                      final narrow =
                          constraints.maxWidth < 280 ||
                          MediaQuery.textScalerOf(context).scale(14) > 20 ||
                          priceWidth > constraints.maxWidth * .44;
                      final heading = Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          MobileOperatorLogo(logoUrl: logoUrl),
                          const SizedBox(width: 12),
                          Expanded(child: details()),
                          if (!range)
                            Padding(
                              padding: const EdgeInsets.only(left: 8),
                              child: Icon(
                                selected
                                    ? Icons.check_circle
                                    : Icons.radio_button_unchecked,
                                color: selected
                                    ? RechargeDesign.navy
                                    : RechargeDesign.border,
                                size: 22,
                              ),
                            ),
                        ],
                      );
                      if (narrow) {
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            heading,
                            const SizedBox(height: 10),
                            price(),
                          ],
                        );
                      }
                      return Row(
                        children: [
                          Expanded(child: heading),
                          const SizedBox(width: 12),
                          Container(
                            padding: const EdgeInsets.only(left: 16),
                            decoration: const BoxDecoration(
                              border: Border(
                                left: BorderSide(color: RechargeDesign.border),
                              ),
                            ),
                            child: ConstrainedBox(
                              constraints: BoxConstraints(
                                maxWidth: constraints.maxWidth * .44,
                              ),
                              child: price(),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                  for (final benefit in product.benefits)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        detailLabel(benefit),
                        style: const TextStyle(
                          color: RechargeDesign.muted,
                          height: 1.35,
                        ),
                      ),
                    ),
                  if (product.description?.trim().isNotEmpty == true)
                    ExpansionTile(
                      key: ValueKey('bundle-description-${product.id}'),
                      tilePadding: EdgeInsets.zero,
                      childrenPadding: const EdgeInsets.only(bottom: 8),
                      dense: true,
                      title: Text(
                        context.ft('providerDescription'),
                        style: const TextStyle(
                          fontSize: 13,
                          color: RechargeDesign.muted,
                        ),
                      ),
                      children: [
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            product.description!,
                            style: const TextStyle(
                              color: RechargeDesign.muted,
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class RechargeAmountField extends StatelessWidget {
  const RechargeAmountField({
    super.key,
    required this.product,
    required this.controller,
    required this.enabled,
    required this.onChanged,
    this.errorText,
  });
  final MobileTopUpProduct product;
  final TextEditingController controller;
  final bool enabled;
  final ValueChanged<String> onChanged;
  final String? errorText;
  @override
  Widget build(BuildContext context) {
    final limits =
        '${context.ft('minimum')}: ${RechargeDesign.number(product.minimumAmount!)} · ${context.ft('maximum')}: ${RechargeDesign.number(product.maximumAmount!)} ${product.priceCurrency}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '${context.ft('amount')} (${product.priceCurrency})',
          style: RechargeDesign.title.copyWith(fontSize: 16),
        ),
        const SizedBox(height: 9),
        LayoutBuilder(
          builder: (context, constraints) {
            const hintStyle = TextStyle(
              color: RechargeDesign.muted,
              fontSize: 12,
            );
            final inline =
                MediaQuery.textScalerOf(context).scale(12) <= 15 &&
                RechargeDesign.textWidth(context, limits, hintStyle) <
                    constraints.maxWidth * .58;
            return TextField(
              key: const ValueKey('range-amount'),
              controller: controller,
              enabled: enabled,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              style: const TextStyle(
                color: RechargeDesign.navy,
                fontSize: 23,
                fontWeight: FontWeight.w800,
              ),
              decoration: RechargeDesign.input().copyWith(
                prefixIcon: Container(
                  margin: const EdgeInsets.only(right: 14),
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: const BoxDecoration(
                    border: Border(
                      right: BorderSide(color: RechargeDesign.border),
                    ),
                  ),
                  child: Text(
                    RechargeDesign.symbol(product.priceCurrency),
                    style: const TextStyle(
                      color: RechargeDesign.muted,
                      fontSize: 23,
                    ),
                  ),
                ),
                prefixIconConstraints: const BoxConstraints(minWidth: 48),
                helperText: inline ? null : limits,
                suffixIcon: inline
                    ? Padding(
                        padding: const EdgeInsets.only(right: 12),
                        child: Text(limits, style: hintStyle),
                      )
                    : null,
                suffixIconConstraints: const BoxConstraints(minHeight: 24),
                helperMaxLines: 3,
                errorText: errorText,
                errorMaxLines: 3,
              ),
              onChanged: onChanged,
            );
          },
        ),
      ],
    );
  }
}

class RechargePriceSummary extends StatelessWidget {
  const RechargePriceSummary({
    super.key,
    required this.quote,
    this.loading = false,
    this.message,
    this.onRetry,
  });
  final MobileTopUpQuote? quote;
  final bool loading;
  final String? message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) {
    final q = quote;
    Widget line(String label, String value, {bool total = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final style = TextStyle(
            color: total ? RechargeDesign.navy : RechargeDesign.muted,
            fontSize: total ? 20 : 15,
            fontWeight: total ? FontWeight.w800 : FontWeight.w400,
          );
          if (constraints.maxWidth < 280 ||
              MediaQuery.textScalerOf(context).scale(15) > 22) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(label, style: style),
                Text(value, textAlign: TextAlign.end, style: style),
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: Text(label, style: style)),
              const SizedBox(width: 12),
              Text(value, style: style),
            ],
          );
        },
      ),
    );
    return Container(
      key: const ValueKey('recharge-price-summary'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: RechargeDesign.radius,
        border: Border.all(color: RechargeDesign.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (loading) const LinearProgressIndicator(),
          line(
            context.ft('amount'),
            q == null
                ? '—'
                : RechargeDesign.money(q.providerAmount, q.providerCurrency),
          ),
          line(
            context.ft('transactionFee'),
            q == null ? '—' : RechargeDesign.money(q.feeUsd, 'USD'),
          ),
          line(
            context.ft('totalToPay'),
            q == null ? '—' : RechargeDesign.money(q.totalChargeUsd, 'USD'),
            total: true,
          ),
          if (q == null && !loading)
            Text(
              message ?? context.ft('selectAmountForTotal'),
              style: const TextStyle(color: RechargeDesign.muted, fontSize: 12),
            ),
          if (onRetry != null)
            TextButton(onPressed: onRetry, child: Text(context.ft('retry'))),
        ],
      ),
    );
  }
}
