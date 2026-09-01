import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'screens/main_navigation_screen.dart';
import 'theme/app_theme.dart';

void main() {
  runApp(const ProviderScope(child: TicashApp()));
}

/// Root widget for the TiCash mobile app.
class TicashApp extends StatelessWidget {
  const TicashApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TiCash',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkTeal,
      home: const MainNavigationScreen(),
    );
  }
}
