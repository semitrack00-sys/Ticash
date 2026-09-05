import 'package:flutter/material.dart';

class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.height = 92, this.lockup = false});

  final double height;
  final bool lockup;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'TiCash',
      image: true,
      child: SizedBox(
        width: lockup ? height * 3.35 : height,
        height: height,
        child: Image.asset(
          lockup
              ? 'assets/images/ticash-lockup.png'
              : 'assets/images/ticash-app-icon.png',
          fit: BoxFit.contain,
          filterQuality: FilterQuality.high,
        ),
      ),
    );
  }
}
