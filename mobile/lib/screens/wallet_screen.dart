import 'package:flutter/material.dart';
import 'placeholder_screen.dart';

/// Wallet management screen (balance, linked cards, payout methods).
class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const PlaceholderScreen(
      title: 'Wallet',
      description: 'Manage your balance, linked cards and payout methods.',
    );
  }
}
