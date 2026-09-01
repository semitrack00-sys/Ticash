import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The five primary sections of the app, in the order they appear in the
/// sidebar / bottom navigation: Home, Send money, Wallet, Activity,
/// Profile.
enum AppSection { home, sendMoney, wallet, activity, profile }

/// Tracks which [AppSection] is currently selected.
final currentSectionProvider =
    StateProvider<AppSection>((ref) => AppSection.home);
