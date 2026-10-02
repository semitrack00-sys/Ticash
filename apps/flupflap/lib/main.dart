import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ticash/providers/mobile_top_up_provider.dart';
import 'package:ticash/screens/topup/mobile_top_up_screen.dart';
import 'package:ticash/services/mobile_top_up_service.dart';
import 'session.dart';

const _navy = Color(0xFF082B55);
const _blue = Color(0xFF1677FF);
const _cyan = Color(0xFF00BCEB);
const _surface = Color(0xFFF6F8FC);
const _muted = Color(0xFF64748B);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  const base = String.fromEnvironment('FLUPFLAP_API_BASE_URL');
  final uri = Uri.tryParse(base);
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty ||
      uri.userInfo.isNotEmpty || uri.hasQuery || uri.hasFragment ||
      !uri.path.endsWith('/api')) {
    runApp(const MaterialApp(home: Scaffold(body: Center(child: Text(
      'FlupFlap requires an approved HTTPS API configuration.',
    )))));
    return;
  }
  final session = FlupFlapSession(
    dio: Dio(BaseOptions(baseUrl: base, connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30))),
    storage: SecureSessionStorage(),
  );
  runApp(FlupFlapApp(session: session));
  session.initialize();
}

class FlupFlapApp extends StatefulWidget {
  const FlupFlapApp({super.key, required this.session});
  final FlupFlapSession session;
  @override State<FlupFlapApp> createState() => _FlupFlapAppState();
}

class _FlupFlapAppState extends State<FlupFlapApp> {
  static const paths = ['/', '/recharge', '/history', '/recipients', '/account'];
  late final GoRouter router = GoRouter(
    refreshListenable: widget.session,
    initialLocation: '/',
    redirect: (context, state) {
      final uri = state.uri;
      if (uri.scheme == 'flupflap') {
        return uri.host == 'reset-password' ? '/reset-password?${uri.query}' : '/recharge';
      }
      if (!widget.session.ready && state.matchedLocation != '/reset-password') {
        return state.matchedLocation == '/loading' ? null : '/loading';
      }
      if (!widget.session.authenticated &&
          !['/login', '/reset-password'].contains(state.matchedLocation)) return '/login';
      if (widget.session.authenticated &&
          ['/loading', '/login'].contains(state.matchedLocation)) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/loading', builder: (_, __) => const Scaffold(
        body: Center(child: CircularProgressIndicator()))),
      GoRoute(path: '/login', builder: (_, __) => AuthScreen(session: widget.session)),
      GoRoute(path: '/reset-password', builder: (_, state) => AuthScreen(
        session: widget.session, resetToken: state.uri.queryParameters['token'])),
      ShellRoute(
        builder: (context, state, child) => Scaffold(
          body: child,
          bottomNavigationBar: SafeArea(
            top: false,
            child: NavigationBar(
              height: 68,
              elevation: 0,
              backgroundColor: Colors.white,
              indicatorColor: const Color(0xFFE4EEFF),
              selectedIndex: paths.indexOf(state.matchedLocation).clamp(0, 4),
              onDestinationSelected: (i) => context.go(paths[i]),
              destinations: const [
                NavigationDestination(icon: Icon(Icons.home_outlined),
                  selectedIcon: Icon(Icons.home_rounded), label: 'Home'),
                NavigationDestination(icon: Icon(Icons.phone_iphone_outlined),
                  selectedIcon: Icon(Icons.phone_iphone_rounded), label: 'Recharge'),
                NavigationDestination(icon: Icon(Icons.receipt_long_outlined),
                  selectedIcon: Icon(Icons.receipt_long_rounded), label: 'History'),
                NavigationDestination(icon: Icon(Icons.people_outline_rounded),
                  selectedIcon: Icon(Icons.people_rounded), label: 'Recipients'),
                NavigationDestination(icon: Icon(Icons.person_outline_rounded),
                  selectedIcon: Icon(Icons.person_rounded), label: 'Account'),
              ],
            ),
          ),
        ),
        routes: [
          GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
          GoRoute(path: '/recharge', builder: (_, __) => const MobileTopUpScreen()),
          GoRoute(path: '/history', builder: (_, __) => const MobileTopUpScreen(initialHistory: true)),
          GoRoute(path: '/recipients', builder: (_, __) => const RecipientsScreen()),
          GoRoute(path: '/account', builder: (_, __) => AccountScreen(session: widget.session)),
        ],
      ),
    ],
  );

  @override void dispose() { router.dispose(); super.dispose(); }

  @override Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.session,
    builder: (_, __) => ProviderScope(
      key: ValueKey(widget.session.user?['id']),
      overrides: [mobileTopUpServiceProvider.overrideWithValue(
        MobileTopUpService(dio: widget.session.dio, basePath: '/flupflap/mobile-topups'))],
      child: MaterialApp.router(
        title: 'FlupFlap',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          scaffoldBackgroundColor: _surface,
          colorScheme: ColorScheme.fromSeed(seedColor: _blue, primary: _blue,
            surface: Colors.white),
          appBarTheme: const AppBarTheme(backgroundColor: _surface, foregroundColor: _navy,
            elevation: 0, centerTitle: false, titleTextStyle: TextStyle(
              fontSize: 22, fontWeight: FontWeight.w800, color: _navy)),
          cardTheme: CardThemeData(color: Colors.white, elevation: 0,
            margin: EdgeInsets.zero, shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.all(Radius.circular(20)),
              side: BorderSide(color: Color(0xFFE5EAF2)))),
          inputDecorationTheme: InputDecorationTheme(
            filled: true, fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: Color(0xFFDCE3EE))),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: Color(0xFFDCE3EE)))),
          filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(54),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
        ),
        routerConfig: router,
      ),
    ),
  );
}

class Brand extends StatelessWidget {
  const Brand({super.key, this.compact = false});
  final bool compact;
  @override Widget build(BuildContext context) => Column(children: [
    Image.asset('assets/flupflap-logo.png', height: compact ? 54 : 76, fit: BoxFit.contain),
    if (!compact) ...[
      const SizedBox(height: 5),
      const Text('Worldwide mobile recharge', style: TextStyle(
        color: _muted, fontSize: 13, fontWeight: FontWeight.w600)),
    ],
  ]);
}

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.session, this.resetToken});
  final FlupFlapSession session;
  final String? resetToken;
  @override State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final firstName = TextEditingController(), lastName = TextEditingController(),
      phone = TextEditingController(), email = TextEditingController(),
      password = TextEditingController();
  bool registration = false, busy = false, obscure = true;
  String? message;
  @override void dispose() {
    firstName.dispose(); lastName.dispose(); phone.dispose(); email.dispose();
    password.dispose(); super.dispose();
  }
  Future<void> run(Future<void> Function() action) async {
    setState(() { busy = true; message = null; });
    try { await action(); } catch (_) {
      if (mounted) setState(() => message =
        'Unable to complete this request. Check your details and try again.');
    } finally { if (mounted) setState(() => busy = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(
    body: SafeArea(child: Center(child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 460),
      child: SingleChildScrollView(padding: const EdgeInsets.all(24), child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Brand(), const SizedBox(height: 28),
          Card(child: Padding(padding: const EdgeInsets.all(22), child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(widget.resetToken != null ? 'Reset your password' :
                registration ? 'Create your account' : 'Welcome back',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w900, color: _navy)),
              const SizedBox(height: 6),
              Text(widget.resetToken != null ? 'Choose a new secure password.' :
                registration ? 'Recharge phones worldwide in a few taps.' :
                'Sign in to continue to FlupFlap.',
                style: const TextStyle(color: _muted)),
              const SizedBox(height: 20),
              if (widget.resetToken == null && registration) ...[
                TextField(controller: firstName, textCapitalization: TextCapitalization.words,
                  autofillHints: const [AutofillHints.givenName],
                  decoration: const InputDecoration(labelText: 'First name',
                    prefixIcon: Icon(Icons.person_outline))),
                const SizedBox(height: 12),
                TextField(controller: lastName, textCapitalization: TextCapitalization.words,
                  autofillHints: const [AutofillHints.familyName],
                  decoration: const InputDecoration(labelText: 'Last name',
                    prefixIcon: Icon(Icons.person_outline))),
                const SizedBox(height: 12),
                TextField(controller: phone, keyboardType: TextInputType.phone,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  decoration: const InputDecoration(labelText: 'Phone number',
                    hintText: '+1 555 123 4567', prefixIcon: Icon(Icons.phone_outlined))),
                const SizedBox(height: 12),
              ],
              if (widget.resetToken == null) ...[
                TextField(controller: email, keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  decoration: const InputDecoration(labelText: 'Email',
                    prefixIcon: Icon(Icons.email_outlined))),
                const SizedBox(height: 12),
              ],
              TextField(controller: password, obscureText: obscure,
                enableSuggestions: false, autocorrect: false,
                decoration: InputDecoration(labelText: 'Password',
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(tooltip: obscure ? 'Show password' : 'Hide password',
                    onPressed: () => setState(() => obscure = !obscure),
                    icon: Icon(obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined)))),
              if (message != null) Padding(padding: const EdgeInsets.only(top: 12),
                child: Text(message!, semanticsLabel: message)),
              const SizedBox(height: 18),
              FilledButton(onPressed: busy ? null : () => run(() async {
                if (widget.resetToken != null) {
                  await widget.session.reset(widget.resetToken!, password.text);
                  if (context.mounted) context.go('/login');
                } else if (registration) {
                  await widget.session.register(firstName: firstName.text.trim(),
                    lastName: lastName.text.trim(), phone: phone.text.trim().replaceAll(' ', ''),
                    email: email.text.trim(), password: password.text);
                } else {
                  await widget.session.login(email.text.trim(), password.text);
                }
              }), child: Text(busy ? 'Please wait…' : widget.resetToken != null ?
                'Update password' : registration ? 'Create account' : 'Sign in')),
              if (widget.resetToken == null) ...[
                TextButton(onPressed: busy ? null : () => setState(() => registration = !registration),
                  child: Text(registration ? 'Already have an account? Sign in' : 'Create an account')),
                if (!registration) TextButton(onPressed: busy ? null : () => run(() async {
                  await widget.session.forgot(email.text.trim());
                  if (mounted) setState(() => message =
                    'If an account exists, reset instructions have been sent.');
                }), child: const Text('Forgot password?')),
              ],
            ],
          ))),
        ],
      )),
    ))),
  );
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});
  @override Widget build(BuildContext context, WidgetRef ref) {
    final recipients = ref.watch(mobileTopUpRecipientsProvider);
    final history = ref.watch(mobileTopUpHistoryProvider);
    return Scaffold(
      appBar: AppBar(title: const Brand(compact: true),
        actions: [IconButton(onPressed: () => context.go('/account'),
          icon: const Icon(Icons.account_circle_outlined), tooltip: 'Account'),
          const SizedBox(width: 8)]),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(mobileTopUpRecipientsProvider);
          ref.invalidate(mobileTopUpHistoryProvider);
        },
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 32), children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [_navy, Color(0xFF1257A5)],
                begin: Alignment.topLeft, end: Alignment.bottomRight),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: Colors.white.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(30)),
                child: const Text('FAST • SIMPLE • WORLDWIDE',
                  style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800))),
              const SizedBox(height: 18),
              const Text('Send airtime in seconds', style: TextStyle(
                color: Colors.white, fontSize: 28, height: 1.1, fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              Text('Recharge family and friends with supported mobile operators around the world.',
                style: TextStyle(color: Colors.white.withValues(alpha: .82), height: 1.4)),
              const SizedBox(height: 22),
              FilledButton.icon(onPressed: () => context.go('/recharge'),
                style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: _navy),
                icon: const Icon(Icons.bolt_rounded), label: const Text('Send a recharge')),
            ]),
          ),
          const SizedBox(height: 24),
          const _SectionTitle(title: 'Quick access'),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: _QuickAction(icon: Icons.phone_iphone_rounded,
              title: 'Recharge', subtitle: 'Send airtime', onTap: () => context.go('/recharge'))),
            const SizedBox(width: 12),
            Expanded(child: _QuickAction(icon: Icons.receipt_long_rounded,
              title: 'History', subtitle: 'Track recharges', onTap: () => context.go('/history'))),
          ]),
          const SizedBox(height: 24),
          _SectionTitle(title: 'Recipients', action: 'View all',
            onAction: () => context.go('/recipients')),
          const SizedBox(height: 12),
          recipients.when(
            loading: () => const _LoadingCard(),
            error: (_, __) => _EmptyCard(icon: Icons.people_outline,
              title: 'Recipients unavailable', subtitle: 'Pull down to try again.'),
            data: (items) => items.isEmpty
              ? _EmptyCard(icon: Icons.person_add_alt_1_outlined, title: 'No saved recipients yet',
                  subtitle: 'Save someone during a recharge for faster sending next time.',
                  action: 'Start recharge', onTap: () => context.go('/recharge'))
              : SizedBox(height: 92, child: ListView.separated(
                  scrollDirection: Axis.horizontal, itemCount: items.take(6).length,
                  separatorBuilder: (_, __) => const SizedBox(width: 10),
                  itemBuilder: (_, i) { final item = items[i]; return Container(
                    width: 150, padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: const Color(0xFFE5EAF2))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Icon(Icons.person_rounded, color: _blue, size: 22),
                      const Spacer(),
                      Text(item.nickname, maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w800)),
                      Text(item.countryCode, style: const TextStyle(color: _muted, fontSize: 12)),
                    ])); })),
          ),
          const SizedBox(height: 24),
          _SectionTitle(title: 'Recent activity', action: 'See history',
            onAction: () => context.go('/history')),
          const SizedBox(height: 12),
          history.when(
            loading: () => const _LoadingCard(),
            error: (_, __) => const _EmptyCard(icon: Icons.receipt_long_outlined,
              title: 'Activity unavailable', subtitle: 'Your recharge history could not be loaded.'),
            data: (items) => items.isEmpty
              ? const _EmptyCard(icon: Icons.receipt_long_outlined, title: 'No recharges yet',
                  subtitle: 'Your latest recharge will appear here.')
              : Card(child: Padding(padding: const EdgeInsets.all(16), child: Row(children: [
                  const CircleAvatar(backgroundColor: Color(0xFFE9F2FF),
                    child: Icon(Icons.phone_iphone_rounded, color: _blue)),
                  const SizedBox(width: 12),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(items.first.productName, maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w800)),
                    Text(items.first.phone, style: const TextStyle(color: _muted, fontSize: 13)),
                  ])),
                  const Icon(Icons.chevron_right_rounded, color: _muted),
                ]))),
          ),
        ]),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.action, this.onAction});
  final String title; final String? action; final VoidCallback? onAction;
  @override Widget build(BuildContext context) => Row(children: [
    Expanded(child: Text(title, style: const TextStyle(color: _navy, fontSize: 18,
      fontWeight: FontWeight.w900))),
    if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
  ]);
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({required this.icon, required this.title, required this.subtitle, required this.onTap});
  final IconData icon; final String title, subtitle; final VoidCallback onTap;
  @override Widget build(BuildContext context) => InkWell(
    onTap: onTap, borderRadius: BorderRadius.circular(20),
    child: Ink(padding: const EdgeInsets.all(16), height: 118,
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE5EAF2))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(width: 38, height: 38, decoration: BoxDecoration(
          color: const Color(0xFFE9F2FF), borderRadius: BorderRadius.circular(12)),
          child: Icon(icon, color: _blue)),
        const Spacer(), Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
        Text(subtitle, style: const TextStyle(color: _muted, fontSize: 12)),
      ])),
  );
}

class _LoadingCard extends StatelessWidget {
  const _LoadingCard();
  @override Widget build(BuildContext context) => const Card(child: Padding(
    padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())));
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.icon, required this.title, required this.subtitle,
    this.action, this.onTap});
  final IconData icon; final String title, subtitle; final String? action; final VoidCallback? onTap;
  @override Widget build(BuildContext context) => Card(child: Padding(
    padding: const EdgeInsets.all(20), child: Row(children: [
      Container(width: 48, height: 48, decoration: BoxDecoration(color: const Color(0xFFE9F2FF),
        borderRadius: BorderRadius.circular(15)), child: Icon(icon, color: _blue)),
      const SizedBox(width: 14), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
        children: [Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
          const SizedBox(height: 3), Text(subtitle, style: const TextStyle(color: _muted, height: 1.35)),
          if (action != null) Padding(padding: const EdgeInsets.only(top: 6),
            child: InkWell(onTap: onTap, child: Text(action!, style: const TextStyle(
              color: _blue, fontWeight: FontWeight.w800))))])),
    ])));
}

class RecipientsScreen extends ConsumerWidget {
  const RecipientsScreen({super.key});
  @override Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    appBar: AppBar(title: const Text('Recipients')),
    body: ref.watch(mobileTopUpRecipientsProvider).when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => Center(child: _EmptyCard(icon: Icons.cloud_off_outlined,
        title: 'Unable to load recipients', subtitle: 'Check your connection and try again.',
        action: 'Retry', onTap: () => ref.invalidate(mobileTopUpRecipientsProvider))),
      data: (items) => items.isEmpty
        ? Center(child: Padding(padding: const EdgeInsets.all(20), child: _EmptyCard(
            icon: Icons.person_add_alt_1_rounded, title: 'Save people you recharge often',
            subtitle: 'Recipients you save during checkout will appear here for quick access.',
            action: 'Start a recharge', onTap: () => context.go('/recharge'))))
        : RefreshIndicator(
            onRefresh: () async => ref.refresh(mobileTopUpRecipientsProvider.future),
            child: ListView.separated(padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
              itemCount: items.length, separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (_, i) { final item = items[i]; return Card(child: ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                leading: CircleAvatar(backgroundColor: const Color(0xFFE9F2FF),
                  child: Text(item.nickname.isEmpty ? '?' : item.nickname[0].toUpperCase(),
                    style: const TextStyle(color: _blue, fontWeight: FontWeight.w900))),
                title: Text(item.nickname, style: const TextStyle(fontWeight: FontWeight.w900)),
                subtitle: Text('${item.countryCode}  •  ${item.phone}'),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => context.go('/recharge'),
              )); }),
          ),
    ),
    floatingActionButton: FloatingActionButton.extended(onPressed: () => context.go('/recharge'),
      icon: const Icon(Icons.add_rounded), label: const Text('Recharge')),
  );
}

class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key, required this.session});
  final FlupFlapSession session;
  @override State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final country = TextEditingController();
  String? message;
  @override void dispose() { country.dispose(); super.dispose(); }
  @override Widget build(BuildContext context) {
    final email = widget.session.guest ? 'Guest recharge session' :
      widget.session.user?['email'] as String? ?? '';
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 32), children: [
        Card(child: Padding(padding: const EdgeInsets.all(20), child: Row(children: [
          Container(width: 58, height: 58, decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [_blue, _cyan]),
            borderRadius: BorderRadius.circular(18)),
            child: const Icon(Icons.person_rounded, color: Colors.white, size: 30)),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.session.guest ? 'Guest' : 'FlupFlap customer',
              style: const TextStyle(color: _navy, fontSize: 18, fontWeight: FontWeight.w900)),
            const SizedBox(height: 3),
            Text(email, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: _muted)),
          ])),
        ]))),
        const SizedBox(height: 20),
        const Text('Profile', style: TextStyle(color: _navy, fontSize: 16, fontWeight: FontWeight.w900)),
        const SizedBox(height: 10),
        if (!widget.session.guest) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Billing country', style: TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 5),
            const Text('Use the 2-letter country code for your billing profile.',
              style: TextStyle(color: _muted, fontSize: 13)),
            const SizedBox(height: 12),
            TextField(controller: country, maxLength: 2,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(labelText: 'Country code',
                hintText: widget.session.user?['countryCode'] as String?,
                prefixIcon: const Icon(Icons.public_rounded))),
            const SizedBox(height: 8),
            FilledButton(onPressed: () async {
              try {
                await widget.session.country(country.text.trim().toUpperCase());
                if (mounted) setState(() => message = 'Profile updated');
              } catch (_) { if (mounted) setState(() => message = 'Unable to update profile'); }
            }, child: const Text('Save profile')),
            if (message != null) Padding(padding: const EdgeInsets.only(top: 10),
              child: Text(message!, textAlign: TextAlign.center)),
          ],
        ))),
        const SizedBox(height: 20),
        const Text('About', style: TextStyle(color: _navy, fontSize: 16, fontWeight: FontWeight.w900)),
        const SizedBox(height: 10),
        Card(child: Column(children: const [
          ListTile(leading: Icon(Icons.shield_outlined, color: _blue), title: Text('Secure recharge'),
            subtitle: Text('Payments and recharge processing use protected server connections.')),
          Divider(height: 1, indent: 56),
          ListTile(leading: Icon(Icons.info_outline_rounded, color: _blue), title: Text('FlupFlap'),
            subtitle: Text('Worldwide Mobile Recharge by TiCash-App')),
        ])),
        const SizedBox(height: 20),
        OutlinedButton.icon(onPressed: () async {
          try { await widget.session.logout(); } catch (_) {}
        }, icon: const Icon(Icons.logout_rounded), label: const Text('Sign out'),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)))),
      ]),
    );
  }
}
