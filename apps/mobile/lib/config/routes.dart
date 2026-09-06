import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../screens/auth/login_screen.dart';
import '../screens/auth/register_screen.dart';
import '../screens/home/home_screen.dart';
import '../screens/profile/profile_screen.dart';
import '../screens/recipients/recipients_screen.dart';
import '../screens/transfer/transfer_screen.dart';
import '../providers/auth_provider.dart';
import '../screens/admin/admin_screen.dart';
import '../screens/activity/activity_screen.dart';
import '../screens/activity/transaction_detail_screen.dart';
import '../screens/splash/splash_screen.dart';
import '../screens/support/support_screen.dart';
import '../screens/kyc/kyc_onboarding_screen.dart';
import '../screens/wallet/wallet_screen.dart';
import '../screens/topup/mobile_top_up_screen.dart';
import '../models/user.dart';

/// Named route paths used throughout the app.
class AppRoutes {
  AppRoutes._();

  static const String login = '/login';
  static const String register = '/register';
  static const String home = '/';
  static const String send = '/send';
  static const String recharge = '/recharge';
  static const String transfer = '/transfer';
  static const String recipients = '/recipients';
  static const String profile = '/profile';
  static const String admin = '/admin';
  static const String activity = '/activity';
  static const String splash = '/splash';
  static const String support = '/support';
  static const String kyc = '/kyc';
  static const String wallet = '/wallet';
  static const String mobileTopUp = '/mobile-recharge';

  /// Public website paths that are safe to preserve through authentication.
  /// No arbitrary redirect URL or query data is accepted.
  static const Set<String> supportedAppLinkPaths = {send, recharge, support};
  static const Set<String> kycProtectedAppLinkPaths = {send, recharge};

  static String? safeContinuation(String? path) {
    return supportedAppLinkPaths.contains(path) ? path : null;
  }

  static bool requiresKyc(String path) {
    return kycProtectedAppLinkPaths.contains(path);
  }

  static String withContinuation(String route, String continuation) {
    return '$route?continue=${Uri.encodeQueryComponent(continuation)}';
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final router = GoRouter(
    initialLocation: AppRoutes.splash,
    redirect: (context, state) {
      final auth = ref.read(authNotifierProvider);
      if (auth.isLoading) {
        if (state.matchedLocation == AppRoutes.splash) return null;
        final continuation = AppRoutes.safeContinuation(state.matchedLocation);
        return continuation == null
            ? AppRoutes.splash
            : AppRoutes.withContinuation(AppRoutes.splash, continuation);
      }
      final isAuthRoute =
          state.matchedLocation == AppRoutes.login ||
          state.matchedLocation == AppRoutes.register;
      final isLoggedIn = auth.valueOrNull != null;
      final continuation = AppRoutes.safeContinuation(
        state.uri.queryParameters['continue'],
      );
      const staffRoles = {
        'ADMIN',
        'SUPER_ADMIN',
        'COMPLIANCE',
        'OPERATIONS',
        'SUPPORT',
        'READ_ONLY',
      };
      final isAdmin = staffRoles.contains(auth.valueOrNull?.role);
      if (state.matchedLocation == AppRoutes.splash) {
        if (!isLoggedIn) {
          return continuation == null
              ? AppRoutes.login
              : AppRoutes.withContinuation(AppRoutes.login, continuation);
        }
        if (isAdmin) return AppRoutes.admin;
        if (auth.valueOrNull?.kycStatus != KycStatus.approved) {
          return continuation == null
              ? AppRoutes.kyc
              : AppRoutes.withContinuation(AppRoutes.kyc, continuation);
        }
        return continuation ?? AppRoutes.home;
      }
      if (!isLoggedIn && !isAuthRoute) {
        final continuation = AppRoutes.safeContinuation(state.matchedLocation);
        return continuation == null
            ? AppRoutes.login
            : AppRoutes.withContinuation(AppRoutes.login, continuation);
      }
      if (isLoggedIn && isAuthRoute) {
        if (isAdmin) return AppRoutes.admin;
        if (auth.valueOrNull?.kycStatus != KycStatus.approved) {
          return continuation == null
              ? AppRoutes.kyc
              : AppRoutes.withContinuation(AppRoutes.kyc, continuation);
        }
        return continuation ?? AppRoutes.home;
      }
      if (isLoggedIn &&
          AppRoutes.requiresKyc(state.matchedLocation) &&
          auth.valueOrNull?.kycStatus != KycStatus.approved) {
        return AppRoutes.withContinuation(AppRoutes.kyc, state.matchedLocation);
      }
      if (isLoggedIn &&
          state.matchedLocation == AppRoutes.kyc &&
          auth.valueOrNull?.kycStatus == KycStatus.approved) {
        return continuation ?? AppRoutes.home;
      }
      if (state.matchedLocation == AppRoutes.admin && !isAdmin) {
        return AppRoutes.home;
      }
      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.register,
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.transfer,
        builder: (context, state) => const TransferScreen(),
      ),
      GoRoute(
        path: AppRoutes.send,
        builder: (context, state) => const TransferScreen(),
      ),
      GoRoute(
        path: AppRoutes.recipients,
        builder: (context, state) => const RecipientsScreen(),
      ),
      GoRoute(
        path: AppRoutes.profile,
        builder: (context, state) => const ProfileScreen(),
      ),
      GoRoute(
        path: AppRoutes.admin,
        builder: (context, state) => const AdminScreen(),
      ),
      GoRoute(
        path: AppRoutes.activity,
        builder: (context, state) => const ActivityScreen(),
      ),
      GoRoute(
        path: '${AppRoutes.activity}/:id',
        builder: (context, state) =>
            TransactionDetailScreen(transferId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: AppRoutes.support,
        builder: (context, state) => const SupportScreen(),
      ),
      GoRoute(
        path: AppRoutes.kyc,
        builder: (context, state) => const KycOnboardingScreen(),
      ),
      GoRoute(
        path: AppRoutes.wallet,
        builder: (context, state) => const WalletScreen(),
      ),
      GoRoute(
        path: AppRoutes.mobileTopUp,
        builder: (context, state) => const MobileTopUpScreen(),
      ),
      GoRoute(
        path: AppRoutes.recharge,
        builder: (context, state) => const MobileTopUpScreen(),
      ),
    ],
  );
  ref.listen(authNotifierProvider, (_, __) => router.refresh());
  ref.onDispose(router.dispose);
  return router;
});
