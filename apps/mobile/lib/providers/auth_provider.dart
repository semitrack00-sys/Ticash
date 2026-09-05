import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/user.dart';
import '../services/auth_service.dart';

/// Provides a singleton [AuthService] instance.
final authServiceProvider = Provider<AuthService>((ref) => AuthService());

/// Holds the currently authenticated user, or `null` if signed out.
class AuthNotifier extends StateNotifier<AsyncValue<User?>> {
  AuthNotifier(this._authService) : super(const AsyncValue.loading()) {
    restoreSession();
  }

  final AuthService _authService;

  Future<void> restoreSession() async {
    state = await AsyncValue.guard(_authService.restoreSession);
  }

  Future<void> login(String email, String password) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(
      () => _authService.login(email: email, password: password),
    );
  }

  Future<void> register({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
  }) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(
      () => _authService.register(
        email: email,
        password: password,
        firstName: firstName,
        lastName: lastName,
      ),
    );
  }

  Future<void> logout() async {
    await _authService.logout();
    state = const AsyncValue.data(null);
  }

  Future<void> changePassword(String currentPassword, String newPassword) {
    return _authService.changePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );
  }

  Future<void> updateProfile({
    required String firstName,
    required String lastName,
    String? phoneNumber,
  }) async {
    final user = await _authService.updateProfile(
      firstName: firstName,
      lastName: lastName,
      phoneNumber: phoneNumber,
    );
    state = AsyncValue.data(user);
  }

  Future<void> requestKycReview() async {
    final user = await _authService.requestKycReview();
    state = AsyncValue.data(user);
  }

  Future<void> refreshCurrentUser() async {
    final current = state.valueOrNull;
    if (current == null) return;
    try {
      final user = await _authService.getCurrentUser();
      state = AsyncValue.data(user);
    } catch (_) {
      state = AsyncValue.data(current);
      rethrow;
    }
  }
}

final authNotifierProvider =
    StateNotifierProvider<AuthNotifier, AsyncValue<User?>>((ref) {
      return AuthNotifier(ref.watch(authServiceProvider));
    });
