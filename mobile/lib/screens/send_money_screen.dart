import 'package:flutter/material.dart';
import 'placeholder_screen.dart';

/// Send money flow entry point. Full multi-step form to follow; kept as
/// a placeholder here so navigation to this section works end to end.
class SendMoneyScreen extends StatelessWidget {
  const SendMoneyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const PlaceholderScreen(
      title: 'Send money',
      description:
          'Send money to MonCash and NatCash wallets across Haiti and beyond.',
    );
  }
}
