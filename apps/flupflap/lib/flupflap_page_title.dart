import 'package:flutter/material.dart';

/// Keeps the official wordmark visible without crowding translated page titles.
class FlupFlapPageTitle extends StatelessWidget {
  const FlupFlapPageTitle(this.title, {super.key});
  final String title;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis),
      ),
      const SizedBox(width: 8),
      Image.asset(
        'assets/flupflap-logo.png',
        width: 88,
        height: 36,
        fit: BoxFit.contain,
        semanticLabel: 'FlupFlap Recharge',
      ),
    ],
  );
}
