import 'package:flutter/material.dart';
import 'placeholder_screen.dart';

/// Account profile screen (identity verification, settings).
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const PlaceholderScreen(
      title: 'Profile',
      description: 'Account details, identity verification and settings.',
    );
  }
}
