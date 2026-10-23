import 'package:flutter/material.dart';

/// Keeps the official wordmark visible without crowding translated page titles.
class FlupFlapPageTitle extends StatelessWidget {
  const FlupFlapPageTitle(this.title, {super.key, this.onNavy = false});
  final String title;
  final bool onNavy;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis),
      ),
      const SizedBox(width: 8),
      if (onNavy)
        _NavyWordmark()
      else
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

/// Uses the existing official isolated mark with the approved white wordmark.
class _NavyWordmark extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Image.asset(
        'assets/flupflap-mark.png',
        width: 32,
        height: 36,
        fit: BoxFit.contain,
        excludeFromSemantics: true,
      ),
      const SizedBox(width: 4),
      const Text(
        'FlupFlap',
        textScaler: TextScaler.noScaling,
        style: TextStyle(
          color: Colors.white,
          fontSize: 19,
          fontWeight: FontWeight.w800,
        ),
      ),
    ],
  );
}
