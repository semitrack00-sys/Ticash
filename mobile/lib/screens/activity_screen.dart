import 'package:flutter/material.dart';
import 'placeholder_screen.dart';

/// Full transaction/activity history screen.
class ActivityScreen extends StatelessWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const PlaceholderScreen(
      title: 'Activity',
      description: 'Full transaction history will appear here.',
    );
  }
}
