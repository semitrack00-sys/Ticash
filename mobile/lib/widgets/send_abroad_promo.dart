import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../models/mock_data.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';

/// "SEND ABROAD" marketing panel: fast delivery pitch, country flags and
/// a "Start a transfer" call to action.
class SendAbroadPromo extends StatelessWidget {
  const SendAbroadPromo({super.key, required this.onStartTransfer});

  final VoidCallback onStartTransfer;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'SEND ABROAD',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.bold,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 8),
          const Text('Fast delivery to mobile wallets', style: AppTextStyles.subheading),
          const SizedBox(height: 6),
          const Text(
            'Start with Haiti and expand across trusted payout partners in Africa.',
            style: AppTextStyles.bodySecondary,
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 16,
            runSpacing: 8,
            children: [
              for (final country in MockData.sendAbroadCountries)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(country['flag']!, style: const TextStyle(fontSize: 18)),
                    const SizedBox(width: 6),
                    Text(country['name']!, style: AppTextStyles.body),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: onStartTransfer,
              child: const Text('Start a transfer'),
            ),
          ),
        ],
      ),
    ).animate().fadeIn(duration: 350.ms).slideY(begin: 0.05, end: 0);
  }
}
