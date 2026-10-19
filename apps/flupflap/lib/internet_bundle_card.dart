import 'package:flutter/material.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'parity_strings.dart';

/// Presentation only: never changes catalog amounts, product IDs or checkout.
/// Extracts an allowance only from an explicit DATA benefit or a complete,
/// unambiguous provider clause. App-specific allowances are never added together.
class BundlePresentation {
  BundlePresentation(MobileTopUpProduct product)
    : title = product.name,
      description = (product.description ?? product.name).trim(),
      benefits = [...product.benefits],
      validity = product.validityLabel {
    final explicitData = product.benefits
        .where(
          (b) => RegExp(
            r'^(?:\d+(?:\.\d+)?\s*(?:GB|MB|TB)|Unlimited)\s+data$',
            caseSensitive: false,
          ).hasMatch(b.trim()),
        )
        .toList();
    if (explicitData.length == 1) {
      allowance = explicitData.single.replaceFirst(
        RegExp(r'\s+data$', caseSensitive: false),
        '',
      );
    }
    final clauses = (description ?? '').split(RegExp(r'\s+-\s+|[\n;]'));
    // Reloadly currently puts denomination descriptions in `name`. Preserve
    // every clause verbatim when separators are explicit; no summarization.
    if (benefits.isEmpty && clauses.length > 1) {
      benefits.addAll(clauses.map((s) => s.trim()).where((s) => s.isNotEmpty));
    }
    final dataClauses = clauses
        .where(
          (s) => RegExp(
            r'^\s*\d+(?:\.\d+)?\s*(?:GB|MB|TB)\s+(?:any use\s+)?data\s*$',
            caseSensitive: false,
          ).hasMatch(s),
        )
        .toList();
    if (allowance == null && dataClauses.length == 1) {
      allowance = RegExp(
        r'\d+(?:\.\d+)?\s*(?:GB|MB|TB)',
        caseSensitive: false,
      ).firstMatch(dataClauses.single)![0];
    }
    final bonuses = clauses
        .where(
          (s) => RegExp(
            r'^\s*\+?\s*\d+(?:\.\d+)?\s*(?:GB|MB|TB)\s+bonus(?:\s+data)?\s*$',
            caseSensitive: false,
          ).hasMatch(s),
        )
        .toList();
    if (bonuses.length == 1) bonus = bonuses.single.trim();
    // Only a complete validity clause; never infer days from a plan's price/name.
    final durations = clauses
        .where(
          (s) => RegExp(
            r'^\s*\d+\s+(?:hours?|days?|weeks?|months?|years?)\s*\.?$',
            caseSensitive: false,
          ).hasMatch(s),
        )
        .toList();
    if (validity == null && durations.length == 1) {
      validity = durations.single.trim();
    }
  }
  final String title;
  final String? description;
  final List<String> benefits;
  String? allowance, bonus, validity;
}

class InternetBundleCard extends StatelessWidget {
  const InternetBundleCard({
    super.key,
    required this.product,
    required this.onSelected,
    this.selected = false,
  });
  final MobileTopUpProduct product;
  final VoidCallback? onSelected;
  final bool selected;
  static const navy = Color(0xFF0B2447);
  static const blue = Color(0xFF2477BA);
  static const line = Color(0xFFE8EDF2);

  @override
  Widget build(BuildContext context) {
    final details = BundlePresentation(product);
    final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
    final left = Container(
      constraints: const BoxConstraints(minHeight: 116),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFFF2F6FA),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            details.allowance ?? context.ft('BUNDLE'),
            style: TextStyle(
              fontSize: details.allowance == null ? 16 : 26,
              height: 1.15,
              fontWeight: FontWeight.w800,
              color: navy,
            ),
          ),
          if (details.bonus != null) ...[
            const SizedBox(height: 4),
            Text(
              details.bonus!,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: navy,
              ),
            ),
          ],
          if (details.validity != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              decoration: BoxDecoration(
                color: const Color(0xFFE7EEF5),
                borderRadius: BorderRadius.circular(7),
              ),
              child: Text(
                details.validity!,
                style: const TextStyle(fontSize: 12, color: navy),
              ),
            ),
          ],
        ],
      ),
    );
    final center = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          details.title == details.description &&
                  (details.benefits.isNotEmpty || details.title.length > 60)
              ? context.ft('BUNDLE')
              : details.title,
          style: const TextStyle(
            fontSize: 15,
            height: 1.25,
            fontWeight: FontWeight.w700,
            color: navy,
          ),
        ),
        if (details.benefits.isNotEmpty) const SizedBox(height: 7),
        for (final benefit in details.benefits)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 1),
                  child: Icon(Icons.check, size: 15, color: blue),
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    benefit,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.3,
                      color: navy,
                    ),
                  ),
                ),
              ],
            ),
          ),
        if (details.description?.isNotEmpty == true)
          Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: Material(
              color: Colors.transparent,
              child: ExpansionTile(
                key: ValueKey('bundle-description-${product.id}'),
                tilePadding: EdgeInsets.zero,
                childrenPadding: EdgeInsets.zero,
                dense: true,
                visualDensity: VisualDensity.compact,
                iconColor: navy,
                collapsedIconColor: navy,
                title: Text(
                  context.ft('providerDescription'),
                  style: const TextStyle(fontSize: 12, color: navy),
                ),
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      details.description!,
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.4,
                        color: navy,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
    final right = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          product.amountType == 'FIXED'
              ? '${product.priceCurrency == 'USD' ? '\$' : ''}${product.price.toStringAsFixed(2)}'
              : '${product.minimumAmount}–${product.maximumAmount}',
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 23,
            height: 1.2,
            fontWeight: FontWeight.w800,
            color: navy,
          ),
        ),
        Text(
          product.priceCurrency,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 12, color: Color(0xFF596B80)),
        ),
        const SizedBox(height: 10),
        FilledButton(
          key: ValueKey('buy-bundle-${product.id}'),
          style: FilledButton.styleFrom(
            backgroundColor: navy,
            foregroundColor: Colors.white,
            minimumSize: const Size(0, 44),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(9),
            ),
          ),
          onPressed: onSelected,
          child: Text(context.ft('buyNow'), textAlign: TextAlign.center),
        ),
      ],
    );
    return Semantics(
      selected: selected,
      container: true,
      child: Container(
        key: ValueKey('bundle-card-${product.id}'),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: selected ? navy : line),
          boxShadow: const [
            BoxShadow(
              color: Color(0x080B2447),
              blurRadius: 8,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: LayoutBuilder(
          builder: (context, constraints) {
            // Keep the reference's three sections at normal text sizes; stack
            // benefits below allowance/price for very narrow or large-text views.
            if (constraints.maxWidth < 280 || scale > 1.4) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: left),
                      const SizedBox(width: 12),
                      Expanded(child: right),
                    ],
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 10),
                    child: Divider(height: 1, color: line),
                  ),
                  center,
                ],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: constraints.maxWidth < 560 ? 80 : 145,
                  child: left,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    decoration: const BoxDecoration(
                      border: Border(
                        left: BorderSide(color: line),
                        right: BorderSide(color: line),
                      ),
                    ),
                    child: center,
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: constraints.maxWidth < 560 ? 86 : 120,
                  child: right,
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
