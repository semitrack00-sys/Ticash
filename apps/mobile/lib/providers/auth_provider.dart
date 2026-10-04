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
  int _epoch = 0;

  Future<void> restoreSession() async {
    final epoch = ++_epoch;
    final next = await AsyncValue.guard(_authService.restoreSession);
    if (epoch == _epoch) state = next;
  }

  Future<void> login(String email, String password) async {
    final epoch = ++_epoch;
    state = const AsyncValue.loading();
    final next = await AsyncValue.guard(
      () => _authService.login(email: email, password: password),
    );
    if (epoch == _epoch) state = next;
  }

  Future<void> register({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    required String countryCode,
    required String addressLine1,
    String? addressLine2,
    required String city,
    String? region,
    String? postalCode,
  }) async {
    final epoch = ++_epoch;
    state = const AsyncValue.loading();
    final next = await AsyncValue.guard(
      () => _authService.register(
        email: email,
        password: password,
        firstName: firstName,
        lastName: lastName,
        countryCode: countryCode,
        addressLine1: addressLine1,
        addressLine2: addressLine2,
        city: city,
        region: region,
        postalCode: postalCode,
      ),
    );
    if (epoch == _epoch) state = next;
  }

  Future<void> logout() async {
    _epoch++;
    state = const AsyncValue.data(null);
    await _authService.logout();
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
    String? countryCode,
    String? addressLine1,
    String? addressLine2,
    String? city,
    String? region,
    String? postalCode,
  }) async {
    final epoch = _epoch;
    final user = await _authService.updateProfile(
      firstName: firstName,
      lastName: lastName,
      phoneNumber: phoneNumber,
      countryCode: countryCode,
      addressLine1: addressLine1,
      addressLine2: addressLine2,
      city: city,
      region: region,
      postalCode: postalCode,
    );
    if (epoch == _epoch) state = AsyncValue.data(user);
  }

  Future<void> requestKycReview() async {
    final epoch = _epoch;
    final user = await _authService.requestKycReview();
    if (epoch == _epoch) state = AsyncValue.data(user);
  }

  Future<void> refreshCurrentUser() async {
    final epoch = _epoch;
    final current = state.valueOrNull;
    if (current == null) return;
    try {
      final user = await _authService.getCurrentUser();
      if (epoch == _epoch) state = AsyncValue.data(user);
    } catch (_) {
      if (epoch == _epoch) state = AsyncValue.data(current);
      rethrow;
    }
  }
}

final authNotifierProvider =
    StateNotifierProvider<AuthNotifier, AsyncValue<User?>>((ref) {
      return AuthNotifier(ref.watch(authServiceProvider));
    });
