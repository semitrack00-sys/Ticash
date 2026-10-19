import 'package:flutter/material.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'parity_strings.dart';

/// Presentation only: never derives a price, expiry or entitlement from prose.
class InternetBundleCard extends StatelessWidget {
  const InternetBundleCard({
    super.key,
    required this.product,
    required this.selected,
    required this.onSelected,
    required this.detailLabel,
  });

  final MobileTopUpProduct product;
  final bool selected;
  final VoidCallback? onSelected;
  final String Function(String) detailLabel;
  static const navy = Color(0xFF102650);
  static const blue = Color(0xFF0868C9);

  @override
  Widget build(BuildContext context) {
    final data = product.benefits.where((value) => RegExp(
      r'^(?:\d+(?:\.\d+)?\s+(?:MB|GB|TB)\s+data|Unlimited DATA)$',
      caseSensitive: false,
    ).hasMatch(value)).toList();
    // Multiple data allowances may have different restrictions. Keep them in
    // the benefits section rather than arbitrarily choosing or summing them.
    final allowance = data.length == 1
        ? data.single.replaceFirst(RegExp(r'\s+data$', caseSensitive: false), '')
        : null;
    final description = product.description;

    Widget summary() => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          allowance == null ? context.ft('bundlePlan') : detailLabel(allowance),
          style: TextStyle(color: navy, fontSize: allowance == null ? 18 : 28,
              fontWeight: FontWeight.w800, height: 1.15),
        ),
        if (product.validityLabel != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(color: const Color(0xFFEDF2F7),
                borderRadius: BorderRadius.circular(6)),
            child: Text(detailLabel(product.validityLabel!),
                style: const TextStyle(color: navy, fontSize: 12)),
          ),
        ],
      ],
    );

    Widget benefits() => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(product.name, style: const TextStyle(color: navy,
            fontSize: 15, fontWeight: FontWeight.w700)),
        for (final benefit in product.benefits) ...[
          const SizedBox(height: 5),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Padding(padding: EdgeInsets.only(top: 2),
                child: Icon(Icons.check, size: 14, color: blue)),
            const SizedBox(width: 6),
            Expanded(child: Text(detailLabel(benefit),
                style: const TextStyle(color: navy, fontSize: 13, height: 1.35))),
          ]),
        ],
        if (description != null && description.trim().isNotEmpty)
          ExpansionTile(
            key: ValueKey('bundle-description-${product.id}'),
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(bottom: 8),
            dense: true,
            visualDensity: VisualDensity.compact,
            title: Text(context.ft('providerDescription'),
                style: const TextStyle(color: navy, fontSize: 12)),
            children: [Align(alignment: Alignment.centerLeft,
                child: Text(description, style: const TextStyle(
                    color: navy, fontSize: 13, height: 1.4)))],
          ),
      ],
    );

    Widget purchase() => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(product.amountType == 'FIXED'
            ? '${product.priceCurrency == 'USD' ? '\$' : ''}${product.price.toStringAsFixed(2)}'
            : '${product.minimumAmount ?? '—'} – ${product.maximumAmount ?? '—'}',
            textAlign: TextAlign.center,
            style: const TextStyle(color: navy, fontSize: 22,
                fontWeight: FontWeight.w800)),
        Text(product.priceCurrency, textAlign: TextAlign.center,
            style: const TextStyle(color: navy, fontSize: 11)),
        const SizedBox(height: 8),
        FilledButton(
          key: ValueKey('bundle-buy-${product.id}'),
          onPressed: onSelected,
          style: FilledButton.styleFrom(
            backgroundColor: navy, foregroundColor: Colors.white,
            minimumSize: const Size(0, 44),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
          child: Text(context.ft('buyNow'), textAlign: TextAlign.center),
        ),
      ],
    );

    return Semantics(
      selected: selected,
      child: Container(
        key: ValueKey('bundle-card-${product.id}'),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? navy : const Color(0xFFE7EBF0)),
          boxShadow: const [BoxShadow(color: Color(0x080F2549),
              blurRadius: 8, offset: Offset(0, 2))],
        ),
        child: LayoutBuilder(builder: (context, constraints) {
          final wide = constraints.maxWidth >= 280 &&
              MediaQuery.textScalerOf(context).scale(14) <= 20;
          if (wide) {
            return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(width: constraints.maxWidth >= 560 ? 120 : 70, child: summary()),
              const SizedBox(width: 8),
              Expanded(child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: const BoxDecoration(border: Border(
                    left: BorderSide(color: Color(0xFFE7EBF0)))),
                child: benefits(),
              )),
              const SizedBox(width: 8),
              SizedBox(width: constraints.maxWidth >= 560 ? 112 : 88, child: purchase()),
            ]);
          }
          // At phone widths retain allowance/price hierarchy without squeezing
          // provider prose into an unreadably narrow middle column.
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (constraints.maxWidth >= 260 &&
                MediaQuery.textScalerOf(context).scale(14) <= 22)
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: summary()),
                const SizedBox(width: 14),
                SizedBox(width: constraints.maxWidth >= 560 ? 112 : 88, child: purchase()),
              ])
            else ...[summary(), const SizedBox(height: 12), purchase()],
            const Padding(padding: EdgeInsets.symmetric(vertical: 8),
                child: Divider(color: Color(0xFFE7EBF0), height: 1)),
            benefits(),
          ]);
        }),
      ),
    );
  }
}
