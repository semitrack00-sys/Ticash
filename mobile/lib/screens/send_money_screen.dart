import 'package:flutter/material.dart';
import 'mobile_topup_screen.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';

/// Entry point for send-money tools, with mobile recharge exposed as its own
/// sandbox sub-flow.
class SendMoneyScreen extends StatelessWidget {
  const SendMoneyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.primaryDark,
      appBar: AppBar(
        backgroundColor: AppColors.primaryDark,
        title: const Text('Send money'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Send money tools', style: AppTextStyles.heading),
            const SizedBox(height: 12),
            const Text(
              'Use TiCash to send money abroad, or open the separate mobile recharge sandbox flow below.',
              style: AppTextStyles.bodySecondary,
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const MobileTopUpScreen(),
                  ),
                );
              },
              child: const Text('Open mobile recharge'),
            ),
          ],
        ),
      ),
    );
  }
}
