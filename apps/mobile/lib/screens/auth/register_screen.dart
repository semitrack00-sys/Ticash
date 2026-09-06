import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/routes.dart';
import '../../config/theme.dart';
import '../../localization/app_localizations.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/brand_logo.dart';
import '../../widgets/language_selector.dart';
import '../../widgets/primary_button.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _country = TextEditingController();
  final _address1 = TextEditingController();
  final _address2 = TextEditingController();
  final _city = TextEditingController();
  final _region = TextEditingController();
  final _postal = TextEditingController();
  bool _obscure = true;

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    _email.dispose();
    _password.dispose();
    _country.dispose();
    _address1.dispose();
    _address2.dispose();
    _city.dispose();
    _region.dispose();
    _postal.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    await ref
        .read(authNotifierProvider.notifier)
        .register(
          email: _email.text.trim(),
          password: _password.text,
          firstName: _first.text.trim(),
          lastName: _last.text.trim(),
          countryCode: _country.text.trim(),
          addressLine1: _address1.text.trim(),
          addressLine2: _address2.text.trim(),
          city: _city.text.trim(),
          region: _region.text.trim(),
          postalCode: _postal.text.trim(),
        );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authNotifierProvider);
    ref.listen(authNotifierProvider, (_, next) {
      next.whenOrNull(
        error: (error, __) => ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString()))),
      );
    });
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: () {
            final continuation = AppRoutes.safeContinuation(
              GoRouterState.of(context).uri.queryParameters['continue'],
            );
            context.go(
              continuation == null
                  ? AppRoutes.login
                  : AppRoutes.withContinuation(AppRoutes.login, continuation),
            );
          },
          icon: const Icon(Icons.arrow_back_rounded),
        ),
        title: Text(context.tr('createAccount')),
        actions: const [LanguageSelector()],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: BrandLogo(height: 64),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      context.tr('startWithTiCash'),
                      style: Theme.of(context).textTheme.headlineMedium
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      context.tr('registerSubtitle'),
                      style: const TextStyle(
                        color: AppTheme.muted,
                        height: 1.45,
                      ),
                    ),
                    const SizedBox(height: 24),
                    Row(
                      children: [
                        Expanded(
                          child: _nameField(_first, context.tr('firstName')),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _nameField(_last, context.tr('lastName')),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      decoration: InputDecoration(
                        labelText: context.tr('emailAddress'),
                        prefixIcon: const Icon(Icons.mail_outline),
                      ),
                      validator: (value) =>
                          value == null || !value.contains('@')
                          ? context.tr('enterValidEmail')
                          : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _country,
                      textCapitalization: TextCapitalization.characters,
                      maxLength: 2,
                      decoration: const InputDecoration(
                        labelText: 'Country or territory code',
                        hintText: 'US, CA, BR, CL, DO, FR…',
                        helperText:
                            'Use the 2-letter country code for your home address.',
                        prefixIcon: Icon(Icons.public_outlined),
                        counterText: '',
                      ),
                      validator: (value) =>
                          value == null ||
                              !RegExp(r'^[A-Za-z]{2}$').hasMatch(value.trim())
                          ? 'Enter a valid 2-letter country code.'
                          : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _address1,
                      textCapitalization: TextCapitalization.words,
                      autofillHints: const [AutofillHints.streetAddressLine1],
                      decoration: const InputDecoration(
                        labelText: 'Street address',
                        prefixIcon: Icon(Icons.home_outlined),
                      ),
                      validator: (value) =>
                          value == null || value.trim().length < 3
                          ? 'Enter your street address.'
                          : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _address2,
                      textCapitalization: TextCapitalization.words,
                      autofillHints: const [AutofillHints.streetAddressLine2],
                      decoration: const InputDecoration(
                        labelText: 'Apartment, suite, unit (optional)',
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _city,
                            textCapitalization: TextCapitalization.words,
                            autofillHints: const [AutofillHints.addressCity],
                            decoration: const InputDecoration(
                              labelText: 'City / locality',
                            ),
                            validator: (value) =>
                                value == null || value.trim().isEmpty
                                ? 'Required'
                                : null,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextFormField(
                            controller: _region,
                            textCapitalization: TextCapitalization.words,
                            autofillHints: const [AutofillHints.addressState],
                            decoration: const InputDecoration(
                              labelText: 'State / province / region',
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _postal,
                      textCapitalization: TextCapitalization.characters,
                      autofillHints: const [AutofillHints.postalCode],
                      decoration: const InputDecoration(
                        labelText: 'ZIP / postal code (if used)',
                        prefixIcon: Icon(Icons.local_post_office_outlined),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      autofillHints: const [AutofillHints.newPassword],
                      decoration: InputDecoration(
                        labelText: context.tr('password'),
                        helperText: context.tr('useAtLeast8'),
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _obscure = !_obscure),
                          icon: Icon(
                            _obscure
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                        ),
                      ),
                      validator: (value) => value == null || value.length < 8
                          ? context.tr('passwordMin')
                          : null,
                    ),
                    const SizedBox(height: 24),
                    PrimaryButton(
                      label: context.tr('createAccount'),
                      icon: Icons.arrow_forward_rounded,
                      isLoading: state.isLoading,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: 18),
                    Text(
                      context.tr('testBuildDisclosure'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 12,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _nameField(TextEditingController controller, String label) {
    return TextFormField(
      controller: controller,
      textCapitalization: TextCapitalization.words,
      decoration: InputDecoration(labelText: label),
      validator: (value) =>
          value == null || value.trim().isEmpty ? context.tr('required') : null,
    );
  }
}
