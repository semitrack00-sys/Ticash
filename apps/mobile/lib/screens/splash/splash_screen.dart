import 'package:flutter/material.dart';

import '../../config/theme.dart';
import '../../localization/app_localizations.dart';
import '../../widgets/brand_logo.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.navy,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const BrandLogo(height: 82, lockup: true),
              const SizedBox(height: 36),
              const SizedBox.square(
                dimension: 28,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: AppTheme.gold,
                ),
              ),
              const SizedBox(height: 18),
              Text(
                context.tr('preparingSession'),
                style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 13),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
