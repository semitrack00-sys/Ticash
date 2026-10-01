import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ticash/providers/mobile_top_up_provider.dart';
import 'package:ticash/screens/topup/mobile_top_up_screen.dart';
import 'package:ticash/services/mobile_top_up_service.dart';
import 'session.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  const base = String.fromEnvironment('FLUPFLAP_API_BASE_URL');
  final uri = Uri.tryParse(base);
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      uri.hasQuery ||
      uri.hasFragment ||
      !uri.path.endsWith('/api')) {
    runApp(
      const MaterialApp(
        home: Scaffold(
          body: Center(
            child: Text(
              'FlupFlap requires an approved HTTPS API configuration.',
            ),
          ),
        ),
      ),
    );
    return;
  }
  final session = FlupFlapSession(
    dio: Dio(
      BaseOptions(
        baseUrl: base,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
      ),
    ),
    storage: SecureSessionStorage(),
  );
  runApp(FlupFlapApp(session: session));
  session.initialize();
}

class FlupFlapApp extends StatefulWidget {
  const FlupFlapApp({super.key, required this.session});
  final FlupFlapSession session;
  @override
  State<FlupFlapApp> createState() => _FlupFlapAppState();
}

class _FlupFlapAppState extends State<FlupFlapApp> {
  late final GoRouter router = GoRouter(
    refreshListenable: widget.session,
    initialLocation: '/',
    redirect: (context, state) {
      final uri = state.uri;
      if (uri.scheme == 'flupflap') {
        return uri.host == 'reset-password'
            ? '/reset-password?${uri.query}'
            : '/recharge';
      }
      if (!widget.session.ready && state.matchedLocation != '/reset-password') {
        return state.matchedLocation == '/loading' ? null : '/loading';
      }
      if (!widget.session.authenticated &&
          !['/login', '/reset-password'].contains(state.matchedLocation)) {
        return '/login';
      }
      if (widget.session.authenticated &&
          ['/loading', '/login'].contains(state.matchedLocation)) {
        return '/';
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/loading',
        builder: (_, state) =>
            const Scaffold(body: Center(child: CircularProgressIndicator())),
      ),
      GoRoute(
        path: '/login',
        builder: (_, state) => AuthScreen(session: widget.session),
      ),
      GoRoute(
        path: '/reset-password',
        builder: (_, state) => AuthScreen(
          session: widget.session,
          resetToken: state.uri.queryParameters['token'],
        ),
      ),
      ShellRoute(
        builder: (context, state, child) => Scaffold(
          body: child,
          bottomNavigationBar: NavigationBar(
            selectedIndex: const [
              '/',
              '/recharge',
              '/history',
              '/recipients',
              '/account',
            ].indexOf(state.matchedLocation).clamp(0, 4),
            onDestinationSelected: (i) => context.go(
              const [
                '/',
                '/recharge',
                '/history',
                '/recipients',
                '/account',
              ][i],
            ),
            destinations: const [
              NavigationDestination(
                icon: Icon(Icons.home_outlined),
                label: 'Home',
              ),
              NavigationDestination(
                icon: Icon(Icons.phone_android),
                label: 'Recharge',
              ),
              NavigationDestination(
                icon: Icon(Icons.history),
                label: 'History',
              ),
              NavigationDestination(
                icon: Icon(Icons.people_outline),
                label: 'Recipients',
              ),
              NavigationDestination(
                icon: Icon(Icons.person_outline),
                label: 'Account',
              ),
            ],
          ),
        ),
        routes: [
          GoRoute(path: '/', builder: (_, state) => const HomeScreen()),
          GoRoute(
            path: '/recharge',
            builder: (_, state) => const MobileTopUpScreen(),
          ),
          GoRoute(
            path: '/history',
            builder: (_, state) =>
                const MobileTopUpScreen(initialHistory: true),
          ),
          GoRoute(
            path: '/recipients',
            builder: (_, state) => const RecipientsScreen(),
          ),
          GoRoute(
            path: '/account',
            builder: (_, state) => AccountScreen(session: widget.session),
          ),
        ],
      ),
    ],
  );
  @override
  void dispose() {
    router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.session,
    builder: (_, child) => ProviderScope(
      key: ValueKey(widget.session.user?['id']),
      overrides: [
        mobileTopUpServiceProvider.overrideWithValue(
          MobileTopUpService(
            dio: widget.session.dio,
            basePath: '/flupflap/mobile-topups',
          ),
        ),
      ],
      child: MaterialApp.router(
        title: 'FlupFlap',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF007AFF)),
          useMaterial3: true,
        ),
        routerConfig: router,
      ),
    ),
  );
}

class Brand extends StatelessWidget {
  const Brand({super.key});
  @override
  Widget build(BuildContext context) => Column(
    children: [
      Image.asset('assets/flupflap-logo.png', height: 84, fit: BoxFit.contain),
      const Text('A service by TiCash-App'),
    ],
  );
}

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.session, this.resetToken});
  final FlupFlapSession session;
  final String? resetToken;
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final firstName = TextEditingController(),
      lastName = TextEditingController(),
      phone = TextEditingController(),
      email = TextEditingController(),
      password = TextEditingController();
  bool registration = false, busy = false, obscure = true;
  String? message;
  @override
  void dispose() {
    firstName.dispose();
    lastName.dispose();
    phone.dispose();
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    setState(() {
      busy = true;
      message = null;
    });
    try {
      await action();
    } catch (_) {
      if (mounted) {
        setState(
          () => message =
              'Unable to complete this request. Check your details and try again.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Brand(),
                const SizedBox(height: 24),
                Text(
                  widget.resetToken != null
                      ? 'Reset FlupFlap password'
                      : registration
                      ? 'Create FlupFlap account'
                      : 'Sign in to FlupFlap',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                if (widget.resetToken == null && registration) ...[
                  TextField(
                    controller: firstName,
                    textCapitalization: TextCapitalization.words,
                    autofillHints: const [AutofillHints.givenName],
                    decoration: const InputDecoration(labelText: 'First name'),
                  ),
                  TextField(
                    controller: lastName,
                    textCapitalization: TextCapitalization.words,
                    autofillHints: const [AutofillHints.familyName],
                    decoration: const InputDecoration(labelText: 'Last name'),
                  ),
                  TextField(
                    controller: phone,
                    keyboardType: TextInputType.phone,
                    autofillHints: const [AutofillHints.telephoneNumber],
                    decoration: const InputDecoration(
                      labelText: 'Phone number',
                      hintText: '+1 555 123 4567',
                    ),
                  ),
                ],
                if (widget.resetToken == null)
                  TextField(
                    controller: email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                TextField(
                  controller: password,
                  obscureText: obscure,
                  enableSuggestions: false,
                  autocorrect: false,
                  decoration: InputDecoration(
                    labelText: 'Password',
                    suffixIcon: IconButton(
                      tooltip: obscure ? 'Show password' : 'Hide password',
                      onPressed: () => setState(() => obscure = !obscure),
                      icon: Icon(
                        obscure ? Icons.visibility : Icons.visibility_off,
                      ),
                    ),
                  ),
                ),
                if (message != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(message!, semanticsLabel: message),
                  ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: busy
                      ? null
                      : () => run(() async {
                          if (widget.resetToken != null) {
                            await widget.session.reset(
                              widget.resetToken!,
                              password.text,
                            );
                            if (context.mounted) context.go('/login');
                          } else if (registration) {
                            await widget.session.register(
                              firstName: firstName.text.trim(),
                              lastName: lastName.text.trim(),
                              phone: phone.text.trim().replaceAll(' ', ''),
                              email: email.text.trim(),
                              password: password.text,
                            );
                          } else {
                            await widget.session.login(
                              email.text.trim(),
                              password.text,
                            );
                          }
                        }),
                  child: Text(
                    busy
                        ? 'Please wait…'
                        : widget.resetToken != null
                        ? 'Update password'
                        : registration
                        ? 'Create account'
                        : 'Sign in',
                  ),
                ),
                if (widget.resetToken == null) ...[
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => setState(() => registration = !registration),
                    child: Text(
                      registration
                          ? 'Already have an account? Sign in'
                          : 'Create account',
                    ),
                  ),
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            await widget.session.forgot(email.text.trim());
                            if (mounted) {
                              setState(
                                () => message =
                                    'If an account exists, reset instructions have been sent.',
                              );
                            }
                          }),
                    child: const Text('Forgot password?'),
                  ),
                  OutlinedButton(
                    onPressed: busy
                        ? null
                        : () => run(widget.session.enterGuest),
                    child: const Text('Continue as guest'),
                  ),
                  const Text(
                    'Guest access is limited to sandbox recharge. Payment and compliance requirements remain enforced by the service.',
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('FlupFlap')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Brand(),
        const SizedBox(height: 24),
        const Text(
          'Send airtime to family and friends. Available countries and products come from the recharge catalog.',
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: () => context.go('/recharge'),
          child: const Text('Start recharge'),
        ),
        TextButton(
          onPressed: () => context.go('/history'),
          child: const Text('Recharge history'),
        ),
      ],
    ),
  );
}

class RecipientsScreen extends ConsumerWidget {
  const RecipientsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    appBar: AppBar(title: const Text('Recharge recipients')),
    body: ref
        .watch(mobileTopUpRecipientsProvider)
        .when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, stack) => Center(
            child: TextButton(
              onPressed: () => ref.invalidate(mobileTopUpRecipientsProvider),
              child: const Text('Unable to load recipients. Retry'),
            ),
          ),
          data: (items) => ListView(
            children: [
              for (final item in items)
                ListTile(
                  title: Text(item.nickname),
                  subtitle: Text('${item.countryCode} · ${item.phone}'),
                ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: FilledButton(
                  onPressed: () => context.go('/recharge'),
                  child: const Text('Use or save a recipient during recharge'),
                ),
              ),
            ],
          ),
        ),
  );
}

class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key, required this.session});
  final FlupFlapSession session;
  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final country = TextEditingController();
  String? message;
  @override
  void dispose() {
    country.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('FlupFlap account')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          widget.session.guest
              ? 'Guest recharge session'
              : widget.session.user?['email'] as String? ?? '',
        ),
        const Text(
          'This account is separate from your TiCash remittance account.',
        ),
        if (!widget.session.guest) ...[
          TextField(
            controller: country,
            maxLength: 2,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(
              labelText: 'Billing country (ISO code)',
              hintText: widget.session.user?['countryCode'] as String?,
            ),
          ),
          FilledButton(
            onPressed: () async {
              try {
                await widget.session.country(country.text.trim().toUpperCase());
                if (mounted) setState(() => message = 'Profile updated');
              } catch (_) {
                if (mounted) {
                  setState(() => message = 'Unable to update profile');
                }
              }
            },
            child: const Text('Save profile'),
          ),
        ],
        if (message != null) Text(message!),
        OutlinedButton(
          onPressed: () async {
            try {
              await widget.session.logout();
            } catch (_) {
              /* Local credentials are already cleared. */
            }
          },
          child: const Text('Sign out'),
        ),
      ],
    ),
  );
}
