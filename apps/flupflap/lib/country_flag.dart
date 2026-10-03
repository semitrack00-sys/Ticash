import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class CountryFlag extends StatelessWidget {
  const CountryFlag(this.code, {super.key});
  final String code;
  // These phone-plan regions are bundled under their territory asset names.
  static String assetCode(String code) => switch (code) {
    'AC' => 'sh-ac',
    'TA' => 'sh-ta',
    _ => code.toLowerCase(),
  };
  @override
  Widget build(BuildContext context) {
    final fallback = Text(
      code,
      style: const TextStyle(fontWeight: FontWeight.w700),
    );
    return SizedBox(
      width: 30,
      height: 22,
      child: RegExp(r'^[A-Z]{2}$').hasMatch(code)
          ? SvgPicture.asset(
              'assets/flags/${assetCode(code)}.svg',
              fit: BoxFit.contain,
              semanticsLabel: code,
              placeholderBuilder: (_) => fallback,
              errorBuilder: (_, __, ___) => fallback,
            )
          : fallback,
    );
  }
}
