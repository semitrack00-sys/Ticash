import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../theme/app_text_styles.dart';

/// Shared layout for sections that are not yet fully implemented
/// (Send money, Wallet, Activity, Profile). Keeps navigation between all
/// five sections working while each screen is built out incrementally.
class PlaceholderScreen extends StatelessWidget {
  const PlaceholderScreen({super.key, required this.title, required this.description});

  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTextStyles.heading),
          const SizedBox(height: 8),
          Text(description, style: AppTextStyles.bodySecondary),
        ],
      ),
    ).animate().fadeIn(duration: 250.ms);
  }
}
