import 'package:flutter/material.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'parity_strings.dart';

const _navy = Color(0xFF082B55);
const _blue = Color(0xFF1677FF);
const _muted = Color(0xFF64748B);

/// A display summary only. Checkout always uses the original provider product.
String planSummary(MobileTopUpProduct product, String fallback) {
  if (product.kind == MobileTopUpKind.airtime) return product.name;
  final data = RegExp(
    r'\b\d+(?:\.\d+)?\s*(?:GB|MB)\b(?:\s*(?:Data)?\s*\+\s*\d+(?:\.\d+)?\s*(?:GB|MB)\b(?:\s*Bonus)?)?',
    caseSensitive: false,
  ).firstMatch(product.name)?.group(0);
  if (data != null) {
    return data.replaceAll(RegExp(r'\s+Data(?=\s*\+)', caseSensitive: false), '').replaceAllMapped(
      RegExp(r'(\d)\s*(GB|MB)', caseSensitive: false),
      (m) => '${m[1]} ${m[2]!.toUpperCase()}',
    );
  }
  final unlimited = RegExp(r'\bUnlimited\s+Data\b', caseSensitive: false)
      .firstMatch(product.name)?.group(0);
  if (unlimited != null) return unlimited;
  return product.name.length <= 48 ? product.name : fallback;
}

String? planValidity(MobileTopUpProduct product) {
  if (product.validityLabel != null) return product.validityLabel;
  final match = RegExp(r'\b(\d+)\s*(hours?|days?|weeks?|months?)\b', caseSensitive: false)
      .firstMatch(product.name);
  return match == null ? null : '${match[1]} ${match[2]!.toLowerCase()}';
}

class RechargePlanCard extends StatelessWidget {
  const RechargePlanCard({
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

  String get price => '${product.priceCurrency == 'USD' ? r'$' : ''}${product.price.toStringAsFixed(2)}';

  void showDetails(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => FractionallySizedBox(
        heightFactor: .75,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(context.ft('planDetails'), style: const TextStyle(
                fontSize: 22, fontWeight: FontWeight.w800, color: _navy,
              )),
              const SizedBox(height: 16),
              Expanded(child: SingleChildScrollView(child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (product.amountType == 'FIXED')
                    Text('$price ${product.priceCurrency}', style: const TextStyle(
                      fontSize: 24, fontWeight: FontWeight.w800, color: _navy,
                    )),
                  const SizedBox(height: 16),
                  // Preserve the complete provider name and terms for review.
                  Text(product.name, style: const TextStyle(fontSize: 16, height: 1.55, color: _navy)),
                  if (product.description != null && product.description != product.name) ...[
                    const SizedBox(height: 12),
                    Text(product.description!, style: const TextStyle(fontSize: 15, height: 1.5, color: _muted)),
                  ],
                  for (final benefit in product.benefits)
                    Padding(padding: const EdgeInsets.only(top: 12), child: Text(detailLabel(benefit))),
                  if (product.validityLabel != null)
                    Padding(padding: const EdgeInsets.only(top: 12), child: Text(detailLabel(product.validityLabel!))),
                ],
              ))),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: onSelected == null ? null : () {
                  onSelected!();
                  Navigator.pop(context);
                },
                child: Text(context.ft(selected ? 'selectedPlan' : 'selectPlan')),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final title = planSummary(product, context.ft(product.kind.name.toUpperCase()));
    final validity = planValidity(product);
    return Semantics(
      selected: selected,
      child: OutlinedButton(
        key: ValueKey('plan-${product.id}'),
        style: OutlinedButton.styleFrom(
          foregroundColor: _navy,
          backgroundColor: selected ? const Color(0xFFE0EEFF) : Colors.white,
          padding: const EdgeInsets.all(16),
          side: BorderSide(color: selected ? _blue : const Color(0xFFE2E8F0), width: selected ? 1.5 : 1),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          alignment: Alignment.centerLeft,
          textStyle: const TextStyle(fontFamily: 'Roboto', fontSize: 14, fontWeight: FontWeight.w400),
        ),
        onPressed: onSelected,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(selected ? Icons.check_circle : Icons.radio_button_unchecked,
                  color: selected ? _blue : const Color(0xFFCBD5E1), size: 22),
                const SizedBox(width: 10),
                Expanded(child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: _navy)),
                    if (validity != null) ...[
                      const SizedBox(height: 5),
                      Text(detailLabel(validity), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _muted)),
                    ],
                  ],
                )),
                if (product.amountType == 'FIXED') ...[
                  const SizedBox(width: 10),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(price, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: _navy)),
                      Text(product.priceCurrency, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _muted)),
                    ],
                  ),
                ],
              ],
            ),
            if (product.amountType == 'RANGE') ...[
              const SizedBox(height: 8),
              Text('${context.ft('minimum')}: ${product.minimumAmount} ${product.priceCurrency} · ${context.ft('maximum')}: ${product.maximumAmount} ${product.priceCurrency}',
                style: const TextStyle(fontSize: 12, height: 1.4, color: _muted)),
            ],
            if (product.kind != MobileTopUpKind.airtime || product.description != null || product.benefits.isNotEmpty) ...[
              const SizedBox(height: 10),
              if ((product.description ?? product.name) != title)
                Text(product.description ?? product.name,
                maxLines: 2, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, height: 1.5, color: _muted)),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => showDetails(context),
                  style: TextButton.styleFrom(
                    foregroundColor: _blue,
                    padding: const EdgeInsets.only(top: 8, bottom: 4, right: 8),
                    minimumSize: const Size(48, 40),
                    tapTargetSize: MaterialTapTargetSize.padded,
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(context.ft('planDetails'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                    const SizedBox(width: 4),
                    const Icon(Icons.chevron_right_rounded, size: 16),
                  ]),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
