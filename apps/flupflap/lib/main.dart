import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:ticash/providers/mobile_top_up_provider.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:ticash/localization/app_localizations.dart';

import 'account_parity.dart';
import 'auth_layout.dart';
import 'checkout_contract.dart';
import 'recharge_journey.dart';
import 'recharge_screen.dart';
import 'parity_strings.dart';
import 'phone_country_field.dart';

import 'package:ticash/services/mobile_top_up_service.dart';
import 'package:ticash/models/mobile_top_up.dart';

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
  late FlupFlapClient client;
  late RechargeJourney journey;
  late RechargeJourney resumeJourney;
  String? owner;
  AppLanguage language = AppLanguage.english;
  @override
  void initState() {
    super.initState();
    _resetJourney();
    resumeJourney = RechargeJourney(
      FlupFlapClient(widget.session.dio),
      guest: () => true,
      storedBillingCountry: () => null,
    );
    widget.session.addListener(_sessionChanged);
  }

  void _resetJourney({bool preserveClient = false}) {
    owner = widget.session.user?['id'] as String?;
    if (!preserveClient) client = FlupFlapClient(widget.session.dio);
    journey = RechargeJourney(
      client,
      guest: () => widget.session.guest,
      storedBillingCountry: () =>
          widget.session.user?['countryCode'] as String?,
      updateStoredBillingCountry: widget.session.country,
    );
  }

  void _sessionChanged() {
    if (owner != widget.session.user?['id']) {
      final signingIn = owner == null && widget.session.user != null;
      journey.dispose();
      if (!signingIn) {
        client.clearCapabilities();
        resumeJourney.dispose();
        resumeJourney = RechargeJourney(
          FlupFlapClient(widget.session.dio),
          guest: () => true,
          storedBillingCountry: () => null,
        );
      }
      _resetJourney(preserveClient: signingIn);
      if (signingIn) client.claim().catchError((Object _) {});
    }
  }

  static const paths = [
    '/',
    '/recharge',
    '/history',
    '/recipients',
    '/account',
  ];
  late final GoRouter router = GoRouter(
    refreshListenable: widget.session,
    initialLocation: '/',
    redirect: (context, state) {
      final uri = state.uri;
      if (uri.scheme == 'flupflap' && uri.host == 'join') {
        final referral = uri.queryParameters['r'];
        final promo = uri.queryParameters['promo'];
        if (referral != null || promo != null) {
          client
              .visit(referral: referral, promo: promo)
              .catchError((Object _) => <String, dynamic>{});
        }
        return '/login';
      }
      if (uri.scheme == 'flupflap' && uri.host == 'checkout-return') {
        final token = uri.queryParameters['checkoutResumeToken'];
        // A second return may resolve to the same route, so notify the
        // memory-only controller directly rather than relying on a rebuild.
        Future.microtask(() {
          if (mounted) resumeJourney.resume(token ?? '');
        });
        return '/checkout-return';
      }
      if (state.matchedLocation == '/checkout-return') return null;
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
        path: '/checkout-return',
        builder: (_, __) {
          return RechargeJourneyScreen(
            journey: resumeJourney,
            returnOnly: true,
          );
        },
      ),
      GoRoute(
        path: '/loading',
        builder: (_, __) => const Scaffold(
          backgroundColor: Colors.white,
          body: Center(child: CircularProgressIndicator()),
        ),
      ),
      GoRoute(
        path: '/login',
        builder: (_, state) => AuthScreen(
          key: ValueKey(state.uri.queryParameters['register']),
          initialRegistration: state.uri.queryParameters['register'] == 'true',
          session: widget.session,
          client: client,
          language: language,
          onLanguage: (v) => setState(() => language = v),
        ),
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
          bottomNavigationBar: SafeArea(
            top: false,
            child: NavigationBar(
              height: 68,
              elevation: 0,
              backgroundColor: Colors.white,
              indicatorColor: const Color(0xFFE4EEFF),
              selectedIndex: paths.indexOf(state.matchedLocation).clamp(0, 4),
              onDestinationSelected: (i) => context.go(paths[i]),
              destinations: [
                NavigationDestination(
                  icon: const Icon(Icons.home_outlined),
                  selectedIcon: const Icon(Icons.home_rounded),
                  label: context.ft('Home'),
                ),
                NavigationDestination(
                  icon: const Icon(Icons.phone_iphone_outlined),
                  selectedIcon: const Icon(Icons.phone_iphone_rounded),
                  label: context.ft('Recharge'),
                ),
                NavigationDestination(
                  icon: const Icon(Icons.receipt_long_outlined),
                  selectedIcon: const Icon(Icons.receipt_long_rounded),
                  label: context.ft('history'),
                ),
                NavigationDestination(
                  icon: const Icon(Icons.people_outline_rounded),
                  selectedIcon: const Icon(Icons.people_rounded),
                  label: context.ft('Recipients'),
                ),
                NavigationDestination(
                  icon: const Icon(Icons.person_outline_rounded),
                  selectedIcon: const Icon(Icons.person_rounded),
                  label: context.ft('Account'),
                ),
              ],
            ),
          ),
        ),
        routes: [
          GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
          GoRoute(
            path: '/recharge',
            builder: (_, state) => RechargeJourneyScreen(
              journey: journey,
              initialRecipient: state.extra is MobileTopUpRecipient
                  ? state.extra as MobileTopUpRecipient
                  : null,
            ),
          ),
          GoRoute(
            path: '/history',
            builder: (_, __) =>
                RechargeJourneyScreen(journey: journey, history: true),
          ),
          GoRoute(
            path: '/recipients',
            builder: (_, __) => const RecipientsScreen(),
          ),
          GoRoute(
            path: '/account',
            builder: (_, __) => AccountScreen(
              session: widget.session,
              client: client,
              language: language,
              onLanguage: (v) => setState(() => language = v),
            ),
          ),
        ],
      ),
    ],
  );

  @override
  void dispose() {
    widget.session.removeListener(_sessionChanged);
    journey.dispose();
    client.clearCapabilities();
    resumeJourney.dispose();
    router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.session,
    builder: (_, __) => ProviderScope(
      key: ValueKey(widget.session.user?['id']),
      overrides: [
        mobileTopUpServiceProvider.overrideWithValue(
          MobileTopUpService(
            dio: widget.session.dio,
            basePath: '/flupflap/mobile-topups',
          ),
        ),
      ],
      child: AppLocalizationScope(
        language: language,
        child: MaterialApp.router(
          title: 'FlupFlap',
          locale: language.materialLocale,
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          supportedLocales: const [
            Locale('en'),
            Locale('fr'),
            Locale('es'),
            Locale('pt'),
          ],
          debugShowCheckedModeBanner: false,
          theme: flupFlapTheme(),
          routerConfig: router,
        ),
      ),
    ),
  );
}

ThemeData flupFlapTheme() => ThemeData(
  useMaterial3: true,
  fontFamily: 'Roboto',
  scaffoldBackgroundColor: _surface,
  colorScheme: ColorScheme.fromSeed(
    seedColor: _blue,
    primary: _blue,
    surface: Colors.white,
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: _surface,
    foregroundColor: _navy,
    elevation: 0,
    centerTitle: false,
    titleTextStyle: TextStyle(
      fontFamily: 'Roboto',
      fontSize: 22,
      fontWeight: FontWeight.w800,
      color: _navy,
    ),
  ),
  cardTheme: const CardThemeData(
    color: Colors.white,
    elevation: 0,
    margin: EdgeInsets.zero,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(20)),
      side: BorderSide(color: Color(0xFFE5EAF2)),
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: Color(0xFFDCE3EE)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: Color(0xFFDCE3EE)),
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size.fromHeight(54),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      textStyle: const TextStyle(
        fontFamily: 'Roboto',
        fontSize: 16,
        fontWeight: FontWeight.w800,
      ),
    ),
  ),
);

class Brand extends StatelessWidget {
  const Brand({super.key, this.compact = false, this.width});
  final bool compact;
  final double? width;
  @override
  Widget build(BuildContext context) => Column(
    children: [
      Image.asset(
        'assets/flupflap-logo.png',
        width: width,
        // Reserve the original 2172x724 logo's space before asset decoding.
        height: width == null ? (compact ? 54 : 76) : width! / 3,
        fit: BoxFit.contain,
      ),
      if (!compact) ...[
        const SizedBox(height: 5),
        Text(
          context.ft('Worldwide mobile recharge'),
          style: const TextStyle(
            color: _muted,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    ],
  );
}

class AuthScreen extends StatefulWidget {
  const AuthScreen({
    super.key,
    required this.session,
    this.resetToken,
    this.client,
    this.language = AppLanguage.english,
    this.onLanguage,
    this.initialRegistration = false,
  });
  final FlupFlapSession session;
  final String? resetToken;
  final FlupFlapClient? client;
  final AppLanguage language;
  final ValueChanged<AppLanguage>? onLanguage;
  final bool initialRegistration;
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
  PhoneEntry? registrationPhone;
  final registrationPhoneKey = GlobalKey();
  bool validatePhone = false;
  String? message;
  @override
  void initState() {
    super.initState();
    registration = widget.initialRegistration;
  }

  bool get phoneValid {
    try {
      return registrationPhone?.requireE164() != null;
    } on FormatException {
      return false;
    }
  }

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
          () => message = context.ft(
            'Unable to complete this request. Check your details and try again.',
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => busy = false);
      }
    }
  }

  Future<void> submit() async {
    if (busy) return;
    if (registration && widget.resetToken == null && !phoneValid) {
      setState(() => validatePhone = true);
      FocusScope.of(context).unfocus();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final field = registrationPhoneKey.currentContext;
        if (mounted && field != null) Scrollable.ensureVisible(field);
      });
      return;
    }
    await run(() async {
      if (widget.resetToken != null) {
        await widget.session.reset(widget.resetToken!, password.text);
        if (mounted) context.go('/login');
      } else if (registration) {
        try {
          await widget.client?.signupStarted();
        } catch (_) {}
        await widget.session.register(
          firstName: firstName.text.trim(),
          lastName: lastName.text.trim(),
          phone:
              registrationPhone?.requireE164() ??
              (throw const FormatException('Missing phone number')),
          email: email.text.trim(),
          password: password.text,
        );
      } else {
        await widget.session.login(email.text.trim(), password.text);
      }
    });
  }

  Future<void> signInWithGoogle() async {
    const clientId = String.fromEnvironment('FLUPFLAP_GOOGLE_CLIENT_ID');
    if (clientId.isEmpty) {
      setState(() => message = context.ft('Google sign-in is not configured.'));
      return;
    }
    await run(() async {
      final account = await GoogleSignIn(
        scopes: const ['email'],
        serverClientId: clientId,
      ).signIn();
      if (account == null) return;
      final token = (await account.authentication).idToken;
      if (token == null || token.isEmpty) throw StateError('Missing Google credential');
      await widget.session.google(token);
    });
  }

  @override
  Widget build(BuildContext context) {
    final signIn = !registration && widget.resetToken == null;
    return AuthLayout(
      signIn: signIn,
      language: widget.language,
      onLanguage: widget.onLanguage,
      logo: Brand(compact: true, width: signIn ? 260 : 220),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            widget.resetToken != null
                ? context.ft('Reset FlupFlap password')
                : registration
                ? context.ft('Create FlupFlap account')
                : context.ft('Welcome'),
            textAlign: signIn ? TextAlign.center : TextAlign.start,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
              fontSize: signIn ? 34 : 24,
              color: _navy,
            ),
          ),
          ...[
            const SizedBox(height: 6),
            Text(
              widget.resetToken != null
                  ? context.ft('Choose a new secure password.')
                  : registration
                  ? context.ft('Recharge phones worldwide in a few taps.')
                  : context.ft('Sign in to continue.'),
              textAlign: signIn ? TextAlign.center : TextAlign.start,
              style: TextStyle(color: _muted, fontSize: signIn ? 17 : 14),
            ),
          ],
          const SizedBox(height: 16),
          if (widget.resetToken == null && registration) ...[
            TextField(
              textInputAction: TextInputAction.next,
              controller: firstName,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.givenName],
              decoration: InputDecoration(
                labelText: context.ft('First name'),
                prefixIcon: const Icon(Icons.person_outline),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              textInputAction: TextInputAction.next,
              controller: lastName,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.familyName],
              decoration: InputDecoration(
                labelText: context.ft('Last name'),
                prefixIcon: const Icon(Icons.person_outline),
              ),
            ),
            const SizedBox(height: 16),
            PhoneCountryField(
              key: registrationPhoneKey,
              fieldKey: const ValueKey('registration-phone'),
              controller: phone,
              countryCode: registrationPhone?.country.code,
              showCountryName: true,
              errorText: validatePhone && !phoneValid
                  ? context.ft('invalidNationalPhone')
                  : null,
              enabled: !busy,
              onChanged: (entry) => setState(() => registrationPhone = entry),
            ),
            const SizedBox(height: 16),
          ],
          if (widget.resetToken == null) ...[
            TextField(
              textInputAction: TextInputAction.next,
              controller: email,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              enableSuggestions: false,
              autofillHints: const [AutofillHints.email],
              decoration: InputDecoration(
                labelText: context.ft('Email'),
                prefixIcon: const Icon(Icons.email_outlined),
              ),
            ),
            const SizedBox(height: 16),
          ],
          TextField(
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => submit(),
            controller: password,
            obscureText: obscure,
            autofillHints: [
              registration || widget.resetToken != null
                  ? AutofillHints.newPassword
                  : AutofillHints.password,
            ],
            enableSuggestions: false,
            autocorrect: false,
            decoration: InputDecoration(
              labelText: context.ft('Password'),
              prefixIcon: const Icon(Icons.lock_outline),
              suffixIcon: IconButton(
                tooltip: obscure
                    ? context.ft('Show password')
                    : context.ft('Hide password'),
                onPressed: () => setState(() => obscure = !obscure),
                icon: Icon(
                  obscure
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                ),
              ),
            ),
          ),
          if (message != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(message!, semanticsLabel: message),
            ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: busy ? null : submit,
            child: Text(
              busy
                  ? context.ft('Please wait…')
                  : widget.resetToken != null
                  ? context.ft('Update password')
                  : registration
                  ? context.ft('Create account')
                  : context.ft('Sign in'),
            ),
          ),
          if (widget.resetToken == null) ...[
            const SizedBox(height: 12),
            SizedBox(
              height: 40,
              child: OutlinedButton.icon(
                key: const ValueKey('google-sign-in'),
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
                onPressed: busy ? null : signInWithGoogle,
                icon: const Icon(Icons.account_circle_outlined, size: 18),
                label: Text(context.ft('Continue with Google')),
              ),
            ),
            const SizedBox(height: 4),
            OutlinedButton(
              onPressed: busy
                  ? null
                  : () => run(() => widget.session.enterGuest()),
              child: Text(context.ft('Continue as guest')),
            ),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              children: [
                TextButton(
                  onPressed: busy
                      ? null
                      : () => setState(() => registration = !registration),
                  child: Text(
                    registration
                        ? context.ft('Already have an account? Sign in')
                        : context.ft('Create account'),
                  ),
                ),
                if (!registration)
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            await widget.session.forgot(email.text.trim());
                            if (mounted) {
                              setState(
                                () => message = context.ft(
                                  'If an account exists, reset instructions have been sent.',
                                ),
                              );
                            }
                          }),
                    child: Text(context.ft('Forgot password?')),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recipients = ref.watch(mobileTopUpRecipientsProvider);
    final history = ref.watch(mobileTopUpHistoryProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Brand(compact: true),
        actions: [
          IconButton(
            onPressed: () => context.go('/account'),
            icon: const Icon(Icons.account_circle_outlined),
            tooltip: context.ft('Account'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(mobileTopUpRecipientsProvider);
          ref.invalidate(mobileTopUpHistoryProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [_navy, Color(0xFF1257A5)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(24),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .12),
                      borderRadius: BorderRadius.circular(30),
                    ),
                    child: Text(
                      context.ft('FAST • SIMPLE • WORLDWIDE'),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    context.ft('Start recharge'),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      height: 1.1,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    context.ft(
                      'Recharge family and friends with supported mobile operators around the world.',
                    ),
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: .82),
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 22),
                  FilledButton.icon(
                    onPressed: () => context.go('/recharge'),
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: _navy,
                    ),
                    icon: const Icon(Icons.bolt_rounded),
                    label: Text(context.ft('Send a recharge')),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            _SectionTitle(title: context.ft('Quick access')),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _QuickAction(
                    icon: Icons.phone_iphone_rounded,
                    title: context.ft('Recharge'),
                    subtitle: context.ft('Send airtime'),
                    onTap: () => context.go('/recharge'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _QuickAction(
                    icon: Icons.receipt_long_rounded,
                    title: context.ft('history'),
                    subtitle: context.ft('Track recharges'),
                    onTap: () => context.go('/history'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            _SectionTitle(
              title: context.ft('Recipients'),
              action: context.ft('View all'),
              onAction: () => context.go('/recipients'),
            ),
            const SizedBox(height: 12),
            recipients.when(
              loading: () => const _LoadingCard(),
              error: (_, __) => _EmptyCard(
                icon: Icons.people_outline,
                title: context.ft('Recipients unavailable'),
                subtitle: context.ft('Pull down to try again.'),
              ),
              data: (items) => items.isEmpty
                  ? _EmptyCard(
                      icon: Icons.person_add_alt_1_outlined,
                      title: context.ft('No saved recipients yet'),
                      subtitle: context.ft(
                        'Save someone during a recharge for faster sending next time.',
                      ),
                      action: 'Add recipient',
                      onTap: () => context.go('/recipients'),
                    )
                  : SizedBox(
                      height: 80 + MediaQuery.textScalerOf(context).scale(40),
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: items.take(6).length,
                        separatorBuilder: (_, __) => const SizedBox(width: 10),
                        itemBuilder: (_, i) {
                          final item = items[i];
                          return InkWell(
                            onTap: () => context.go('/recharge', extra: item),
                            borderRadius: BorderRadius.circular(18),
                            child: Ink(
                              width: 150,
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(18),
                                border: Border.all(
                                  color: const Color(0xFFE5EAF2),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Icon(
                                    Icons.person_rounded,
                                    color: _blue,
                                    size: 22,
                                  ),
                                  const Spacer(),
                                  Text(
                                    item.nickname,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  Text(
                                    item.countryCode,
                                    style: const TextStyle(
                                      color: _muted,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
            ),
            const SizedBox(height: 24),
            _SectionTitle(
              title: context.ft('Recent activity'),
              action: context.ft('See history'),
              onAction: () => context.go('/history'),
            ),
            const SizedBox(height: 12),
            history.when(
              loading: () => const _LoadingCard(),
              error: (_, __) => _EmptyCard(
                icon: Icons.receipt_long_outlined,
                title: context.ft('Activity unavailable'),
                subtitle: context.ft(
                  'Your recharge history could not be loaded.',
                ),
              ),
              data: (items) => items.isEmpty
                  ? _EmptyCard(
                      icon: Icons.receipt_long_outlined,
                      title: context.ft('No recharges yet'),
                      subtitle: context.ft(
                        'Your latest recharge will appear here.',
                      ),
                    )
                  : Card(
                      child: InkWell(
                        onTap: () => context.go('/history'),
                        borderRadius: BorderRadius.circular(20),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            children: [
                              const CircleAvatar(
                                backgroundColor: Color(0xFFE9F2FF),
                                child: Icon(
                                  Icons.phone_iphone_rounded,
                                  color: _blue,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      items.first.productName,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    Text(
                                      items.first.phone,
                                      style: const TextStyle(
                                        color: _muted,
                                        fontSize: 13,
                                      ),
                                    ),
                                    Text(
                                      '${context.ft(items.first.status.name.toUpperCase())} · USD ${items.first.totalChargeUsd.toStringAsFixed(2)}',
                                      style: const TextStyle(
                                        color: _navy,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const Icon(
                                Icons.chevron_right_rounded,
                                color: _muted,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.action, this.onAction});
  final String title;
  final String? action;
  final VoidCallback? onAction;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          title,
          style: const TextStyle(
            color: _navy,
            fontSize: 18,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
    ],
  );
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final String title, subtitle;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(20),
    child: Ink(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE5EAF2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: const Color(0xFFE9F2FF),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: _blue),
          ),
          const SizedBox(height: 12),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
          Text(subtitle, style: const TextStyle(color: _muted, fontSize: 12)),
        ],
      ),
    ),
  );
}

class _LoadingCard extends StatelessWidget {
  const _LoadingCard();
  @override
  Widget build(BuildContext context) => const Card(
    child: Padding(
      padding: EdgeInsets.all(24),
      child: Center(child: CircularProgressIndicator()),
    ),
  );
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.action,
    this.onTap,
  });
  final IconData icon;
  final String title, subtitle;
  final String? action;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: const Color(0xFFE9F2FF),
              borderRadius: BorderRadius.circular(15),
            ),
            child: Icon(icon, color: _blue),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: const TextStyle(color: _muted, height: 1.35),
                ),
                if (action != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: TextButton(
                      onPressed: onTap,
                      child: Text(
                        action!,
                        style: const TextStyle(
                          color: _blue,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class RecipientsScreen extends ConsumerWidget {
  const RecipientsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    appBar: AppBar(title: Text(context.ft('Recipients'))),
    body: ref
        .watch(mobileTopUpRecipientsProvider)
        .when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, __) => Center(
            child: _EmptyCard(
              icon: Icons.cloud_off_outlined,
              title: context.ft('Unable to load recipients'),
              subtitle: context.ft('Check your connection and try again.'),
              action: 'Retry',
              onTap: () => ref.invalidate(mobileTopUpRecipientsProvider),
            ),
          ),
          data: (items) => items.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: _EmptyCard(
                      icon: Icons.person_add_alt_1_rounded,
                      title: context.ft('Save people you recharge often'),
                      subtitle: context.ft(
                        'Recipients you save during checkout will appear here for quick access.',
                      ),
                      action: context.ft('Start a recharge'),
                      onTap: () => context.go('/recharge'),
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () async =>
                      ref.refresh(mobileTopUpRecipientsProvider.future),
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (_, i) {
                      final item = items[i];
                      return Card(
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 8,
                          ),
                          leading: CircleAvatar(
                            backgroundColor: const Color(0xFFE9F2FF),
                            child: Text(
                              item.nickname.isEmpty
                                  ? '?'
                                  : item.nickname[0].toUpperCase(),
                              style: const TextStyle(
                                color: _blue,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          title: Text(
                            item.nickname,
                            style: const TextStyle(fontWeight: FontWeight.w900),
                          ),
                          subtitle: Text(
                            '${item.countryCode}  •  ${item.phone}',
                          ),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () => context.go('/recharge', extra: item),
                        ),
                      );
                    },
                  ),
                ),
        ),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: () => showDialog<void>(
        context: context,
        builder: (_) => const _AddRecipientDialog(),
      ),
      icon: const Icon(Icons.add_rounded),
      label: Text(context.ft('Add recipient')),
    ),
  );
}

class _AddRecipientDialog extends ConsumerStatefulWidget {
  const _AddRecipientDialog();
  @override
  ConsumerState<_AddRecipientDialog> createState() =>
      _AddRecipientDialogState();
}

class _AddRecipientDialogState extends ConsumerState<_AddRecipientDialog> {
  final nickname = TextEditingController(), phone = TextEditingController();
  String? countryCode, error;
  PhoneEntry? recipientPhone;
  bool busy = false;
  @override
  void dispose() {
    nickname.dispose();
    phone.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (busy) return;
    if (countryCode == null ||
        nickname.text.trim().isEmpty ||
        phone.text.trim().isEmpty) {
      setState(
        () => error = context.ft(
          'Enter a name, country and international phone number.',
        ),
      );
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      // The worldwide phone list is not a promise of recharge coverage.
      final countries = await ref.refresh(mobileTopUpCountriesProvider.future);
      if (!countries.any((country) => country.code == countryCode)) {
        throw const FormatException('Unsupported recharge country');
      }
      await ref
          .read(mobileTopUpServiceProvider)
          .saveRecipient(
            nickname: nickname.text.trim(),
            phone: recipientPhone!.requireE164(),
            countryCode: countryCode!,
          );
      ref.invalidate(mobileTopUpRecipientsProvider);
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      if (mounted) {
        setState(
          () => error = context.ft(
            'Unable to save recipient. Check the details and try again.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(context.ft('Add recipient')),
    content: SizedBox(
      width: 360,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nickname,
              enabled: !busy,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: context.ft('Recipient name'),
              ),
            ),
            const SizedBox(height: 12),
            PhoneCountryField(
              controller: phone,
              enabled: !busy,
              countryCode: countryCode,
              textInputAction: TextInputAction.done,
              onSubmitted: save,
              onChanged: (entry) => setState(() {
                recipientPhone = entry;
                countryCode = entry.country.code;
              }),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: busy ? null : () => Navigator.of(context).pop(),
        child: Text(context.ft('Cancel')),
      ),
      TextButton(
        onPressed: busy ? null : save,
        child: Text(
          busy ? context.ft('Saving…') : context.ft('Save recipient'),
        ),
      ),
    ],
  );
}

class AccountScreen extends StatefulWidget {
  const AccountScreen({
    super.key,
    required this.session,
    required this.client,
    required this.language,
    required this.onLanguage,
  });
  final FlupFlapSession session;
  final FlupFlapClient client;
  final AppLanguage language;
  final ValueChanged<AppLanguage> onLanguage;
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
  Widget build(BuildContext context) {
    final email = widget.session.guest
        ? context.ft('Guest recharge session')
        : widget.session.user?['email'] as String? ?? '';
    return Scaffold(
      appBar: AppBar(title: Text(context.ft('FlupFlap account'))),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: OutlinedButton.icon(
            onPressed: () async {
              try {
                await widget.session.logout();
              } catch (_) {}
            },
            icon: const Icon(Icons.logout_rounded),
            label: Text(context.ft('Sign out')),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Container(
                    width: 58,
                    height: 58,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(colors: [_blue, _cyan]),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: const Icon(
                      Icons.person_rounded,
                      color: Colors.white,
                      size: 30,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.session.guest
                              ? context.ft('Guest')
                              : context.ft('FlupFlap customer'),
                          style: const TextStyle(
                            color: _navy,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          email,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: _muted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            context.ft(
              'This account is separate from your TiCash remittance account.',
            ),
            style: const TextStyle(color: _muted, fontSize: 13),
          ),
          const SizedBox(height: 20),
          AccountParity(
            session: widget.session,
            client: widget.client,
            language: widget.language,
            onLanguage: widget.onLanguage,
          ),
          if (!widget.session.guest)
            Text(
              context.ft('Profile'),
              style: const TextStyle(
                color: _navy,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
          const SizedBox(height: 10),
          if (!widget.session.guest)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      context.ft('Billing country'),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      context.ft(
                        'Use the 2-letter country code for your billing profile.',
                      ),
                      style: const TextStyle(color: _muted, fontSize: 13),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: country,
                      maxLength: 2,
                      textCapitalization: TextCapitalization.characters,
                      decoration: InputDecoration(
                        labelText: context.ft('Country code'),
                        hintText:
                            widget.session.user?['countryCode'] as String?,
                        prefixIcon: const Icon(Icons.public_rounded),
                      ),
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      onPressed: () async {
                        try {
                          await widget.session.country(
                            country.text.trim().toUpperCase(),
                          );
                          if (mounted) {
                            setState(
                              () => message = context.ft('Profile updated'),
                            );
                          }
                        } catch (_) {
                          if (mounted) {
                            setState(
                              () => message = context.ft(
                                'Unable to update profile',
                              ),
                            );
                          }
                        }
                      },
                      child: Text(context.ft('Save profile')),
                    ),
                    if (message != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text(message!, textAlign: TextAlign.center),
                      ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 20),
          Text(
            context.ft('About'),
            style: const TextStyle(
              color: _navy,
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.shield_outlined, color: _blue),
                  title: Text(context.ft('Secure recharge')),
                  subtitle: Text(
                    context.ft(
                      'Payments and recharge processing use protected server connections.',
                    ),
                  ),
                ),
                const Divider(height: 1, indent: 56),
                ListTile(
                  leading: const Icon(Icons.info_outline_rounded, color: _blue),
                  title: const Text('FlupFlap'),
                  subtitle: Text(
                    context.ft('Worldwide Mobile Recharge by TiCash-App'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
