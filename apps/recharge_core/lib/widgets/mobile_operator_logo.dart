import 'package:flutter/material.dart';

import '../models/mobile_top_up.dart';

class MobileOperatorLogo extends StatelessWidget {
  const MobileOperatorLogo({super.key, this.logoUrl});

  final String? logoUrl;

  @override
  Widget build(BuildContext context) {
    final url = MobileTopUpOperator.parseLogoUrl(logoUrl);
    const fallback = Icon(Icons.sim_card_outlined, size: 24);
    return Container(
      width: 36,
      height: 36,
      padding: const EdgeInsets.all(3),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFFF5F6F8),
        borderRadius: BorderRadius.circular(8),
      ),
      child: url == null
          ? fallback
          : Image.network(
              url,
              key: ValueKey(url),
              fit: BoxFit.contain,
              excludeFromSemantics: true,
              frameBuilder: (context, child, frame, synchronous) =>
                  synchronous || frame != null ? child : fallback,
              loadingBuilder: (context, child, progress) =>
                  progress == null ? child : fallback,
              errorBuilder: (context, error, stackTrace) => fallback,
            ),
    );
  }
}
