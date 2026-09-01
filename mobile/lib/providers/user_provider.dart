import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/mock_data.dart';
import '../models/user.dart';

/// Holds the current user, seeded with mock data.
///
/// Exposed as a [StateNotifierProvider] so screens can react to balance
/// changes (e.g. after a transfer) and so the balance-visibility toggle
/// on [BalanceCard] can be driven independently.
class UserNotifier extends StateNotifier<AsyncValue<TicashUser>> {
  UserNotifier() : super(const AsyncValue.loading()) {
    _load();
  }

  Future<void> _load() async {
    // Simulates an API call; replace with a real ApiClient call once the
    // backend endpoint is available.
    await Future<void>.delayed(const Duration(milliseconds: 200));
    state = const AsyncValue.data(MockData.user);
  }

  void refresh() => _load();
}

final userProvider =
    StateNotifierProvider<UserNotifier, AsyncValue<TicashUser>>(
  (ref) => UserNotifier(),
);

/// Whether the balance amount is currently visible (vs. masked with
/// dots). Defaults to visible, matching the mockup.
final balanceVisibleProvider = StateProvider<bool>((ref) => true);
