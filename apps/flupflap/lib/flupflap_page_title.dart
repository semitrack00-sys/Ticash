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

/// Retains the official multicolour mark and uses the approved white wordmark.
/// The existing source artwork includes a dark tagline; clip only its mark for
/// this compact header, leaving the full original logo intact everywhere else.
class _NavyWordmark extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      ClipRect(
        child: SizedBox(
          width: 32,
          height: 30,
          child: OverflowBox(
            alignment: Alignment.topLeft,
            maxWidth: 104,
            maxHeight: 35,
            child: Image.asset(
              'assets/flupflap-logo.png',
              width: 104,
              height: 35,
              fit: BoxFit.contain,
              excludeFromSemantics: true,
            ),
          ),
        ),
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
