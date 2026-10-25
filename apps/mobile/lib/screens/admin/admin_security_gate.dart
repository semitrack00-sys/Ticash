import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../services/api_client.dart';

/// Enrollments and recovery codes remain in this screen's memory only.
class AdminSecurityGate extends StatefulWidget {
  const AdminSecurityGate({super.key, required this.onVerified, this.dio});
  final VoidCallback onVerified;
  final Dio? dio;
  @override
  State<AdminSecurityGate> createState() => _AdminSecurityGateState();
}

class _AdminSecurityGateState extends State<AdminSecurityGate> {
  final password = TextEditingController(), code = TextEditingController();
  Dio get client => widget.dio ?? ApiClient.instance.dio;
  bool busy = true, enabled = false;
  int step = 0;
  String? challengeId, secret, message;
  List<String> recoveryCodes = [];
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final r = await client.get('/admin/security');
      if (!mounted) return;
      setState(() {
        enabled = r.data['enabled'] == true;
        step = enabled ? 3 : 0;
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => message =
              'Security setup is unavailable. Contact the account owner.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    password.dispose();
    code.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (busy) return;
    setState(() {
      busy = true;
      message = null;
    });
    try {
      final action = step == 0
          ? 'start'
          : step == 1
          ? 'setup'
          : step == 2
          ? 'confirm'
          : 'verify';
      final r = await client.post(
        '/admin/security/$action',
        data: {
          'password': password.text,
          if (step != 0) 'code': code.text.trim(),
          if (step == 1) 'challengeId': challengeId,
        },
      );
      if (!mounted) return;
      if (step == 0) {
        setState(() {
          challengeId = r.data['challengeId'] as String;
          step = 1;
          code.clear();
        });
      } else if (step == 1) {
        setState(() {
          secret = r.data['secret'] as String;
          step = 2;
          code.clear();
        });
      } else {
        final proof = r.data['proof'];
        if (proof is! String) {
          throw const FormatException('Invalid security response');
        }
        client.options.headers['X-Admin-MFA'] = proof;
        password.clear();
        code.clear();
        secret = null;
        if (step == 2) {
          setState(() {
            recoveryCodes = (r.data['recoveryCodes'] as List).cast<String>();
            step = 4;
          });
        } else {
          widget.onVerified();
        }
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => message = 'Verification failed or expired. Check your details and try again.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 540),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(Icons.admin_panel_settings_outlined, size: 42),
                const SizedBox(height: 12),
                Text(
                  enabled
                      ? 'Verify administrator access'
                      : 'Set up administrator authenticator',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 12),
                if (step == 0)
                  const Text(
                    'Confirm your password, then verify the code sent to your staff email. Add the authenticator key to an app such as Google Authenticator or Microsoft Authenticator.',
                  ),
                if (step == 1)
                  const Text(
                    'Enter the six-digit code sent to your staff email.',
                  ),
                if (step == 2) ...[
                  const Text(
                    'Add this setup key to your authenticator app as a time-based account named TiCash Admin. Keep the key private.',
                  ),
                  const SizedBox(height: 8),
                  SelectableText(secret ?? ''),
                  const SizedBox(height: 12),
                ],
                if (step == 3)
                  const Text(
                    'Enter your password and an authenticator code or an unused recovery code. Verification expires after 15 minutes and when your sign-in token changes.',
                  ),
                if (step == 4) ...[
                  const Text(
                    'Save these single-use recovery codes privately. They are shown only now. Each code can replace one authenticator verification.',
                  ),
                  const SizedBox(height: 12),
                  SelectableText(recoveryCodes.join('\n')),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: widget.onVerified,
                    child: const Text('I saved my recovery codes — continue'),
                  ),
                ] else ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    decoration: const InputDecoration(
                      labelText: 'Current password',
                    ),
                  ),
                  if (step > 0)
                    TextField(
                      controller: code,
                      autocorrect: false,
                      enableSuggestions: false,
                      decoration: InputDecoration(
                        labelText: step == 1
                            ? 'Email security code'
                            : step == 3
                            ? 'Authenticator or recovery code'
                            : 'Authenticator code',
                      ),
                    ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: busy ? null : submit,
                    child: Text(step == 0 ? 'Send setup email' : 'Verify'),
                  ),
                ],
                if (message != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(message!),
                  ),
                if (busy) const LinearProgressIndicator(),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
