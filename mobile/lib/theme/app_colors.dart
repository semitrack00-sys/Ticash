import 'package:flutter/material.dart';

/// Centralized color palette for the TiCash mobile app.
///
/// All screens and widgets must reference these constants instead of
/// hardcoding color values, so the app stays consistent with the
/// TiCash Floot mockup and can be re-themed from a single place.
class AppColors {
  AppColors._();

  /// Dark teal background used across screens.
  static const Color primaryDark = Color(0xFF1A3A3A);

  /// Teal accent used for buttons, highlights and active states.
  static const Color primary = Color(0xFF2D7A7A);

  /// White, used for primary buttons and high-emphasis text on dark
  /// backgrounds.
  static const Color secondary = Color(0xFFFFFFFF);

  /// Status color for completed transactions.
  static const Color success = Color(0xFF4CAF50);

  /// Status color for pending transactions.
  static const Color pending = Color(0xFFFF9800);

  /// Primary text color (used on dark backgrounds).
  static const Color textPrimary = Color(0xFFFFFFFF);

  /// Secondary/muted text color.
  static const Color textSecondary = Color(0xFFB0B0B0);

  /// Slightly lighter teal used for cards sitting on [primaryDark].
  static const Color surface = Color(0xFF234B4B);

  /// Divider / subtle border color.
  static const Color border = Color(0x33FFFFFF);
}
