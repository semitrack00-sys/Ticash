import 'package:flutter/material.dart';

import 'parity_strings.dart';
import 'session.dart';

class AccountSecurityCard extends StatefulWidget {
  const AccountSecurityCard({super.key, required this.session});
  final FlupFlapSession session;
  @override
  State<AccountSecurityCard> createState() => _AccountSecurityCardState();
}

class _AccountSecurityCardState extends State<AccountSecurityCard> {
  final password = TextEditingController(),
      newValue = TextEditingController(),
      code = TextEditingController();
  bool available = false, busy = false;
  String? action, challengeId, message;
  int step = 0;
  List<dynamic> sessions = [];
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final r = await widget.session.dio.get('/flupflap/auth/security');
      final s = await widget.session.dio.get('/flupflap/auth/sessions');
      if (mounted)
        setState(() {
          available = r.data['enabled'] == true;
          sessions = s.data['sessions'] as List<dynamic>;
        });
    } catch (_) {
      /* Account access remains available when a server is older. */
    }
  }

  @override
  void dispose() {
    password.dispose();
    newValue.dispose();
    code.dispose();
    super.dispose();
  }

  void choose(String value) {
    setState(() {
      action = value;
      step = 0;
      challengeId = null;
      message = null;
      password.clear();
      newValue.clear();
      code.clear();
    });
  }

  Future<void> submit() async {
    if (busy || action == null) return;
    setState(() {
      busy = true;
      message = null;
    });
    try {
      if (action == 'logout') {
        await widget.session.signOutAll(password.text);
        return;
      }
      final email = action == 'email';
      final route = step == 0
          ? '${action!}-send'
          : email && step == 1
          ? 'email-current'
          : '${action!}-confirm';
      final r = await widget.session.dio.post(
        '/flupflap/auth/security/$route',
        data: {
          'password': password.text,
          if (email) 'newEmail': newValue.text.trim(),
          if (!email && step > 0) 'newPassword': newValue.text,
          if (step > 0) 'challengeId': challengeId,
          if (step > 0) 'code': code.text.trim(),
        },
      );
      if (!mounted) return;
      if (r.data['changed'] == true) {
        await widget.session.securityChanged(
          email ? 'emailChangedSignIn' : 'passwordChangedSignIn',
        );
        return;
      }
      setState(() {
        challengeId = r.data['challengeId'] as String;
        step++;
        code.clear();
        message = 'securityCodeSent';
      });
    } catch (_) {
      if (mounted) setState(() => message = 'securityFailed');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            context.ft('accountSecurity'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (sessions.isNotEmpty)
            Text('${context.ft('activeSessions')}: ${sessions.length}'),
          Wrap(
            spacing: 8,
            children: [
              TextButton(
                onPressed: busy ? null : () => choose('logout'),
                child: Text(context.ft('signOutAllDevices')),
              ),
              if (available)
                TextButton(
                  onPressed: busy ? null : () => choose('password'),
                  child: Text(context.ft('changePassword')),
                ),
              if (available)
                TextButton(
                  onPressed: busy ? null : () => choose('email'),
                  child: Text(context.ft('changeEmail')),
                ),
            ],
          ),
          if (action != null) ...[
            TextField(
              controller: password,
              obscureText: true,
              decoration: InputDecoration(
                labelText: context.ft('currentPassword'),
              ),
            ),
            if (action != 'logout')
              TextField(
                controller: newValue,
                obscureText: action == 'password',
                readOnly: step > 0,
                keyboardType: action == 'email'
                    ? TextInputType.emailAddress
                    : TextInputType.visiblePassword,
                decoration: InputDecoration(
                  labelText: context.ft(
                    action == 'email' ? 'newEmail' : 'newPassword',
                  ),
                ),
              ),
            if (step > 0) ...[
              Text(
                context.ft(
                  action == 'email' && step == 1
                      ? 'verifyCurrentInbox'
                      : action == 'email'
                      ? 'verifyNewInbox'
                      : 'securityCodeSent',
                ),
              ),
              TextField(
                controller: code,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                decoration: InputDecoration(
                  labelText: context.ft('securityCode'),
                ),
              ),
            ],
            FilledButton(
              onPressed: busy ? null : submit,
              child: Text(
                context.ft(
                  action == 'logout'
                      ? 'signOutAllDevices'
                      : step == 0
                      ? 'sendSecurityCode'
                      : 'confirmSecurityChange',
                ),
              ),
            ),
            TextButton(
              onPressed: busy
                  ? null
                  : () => setState(() {
                      action = null;
                      password.clear();
                      newValue.clear();
                      code.clear();
                      message = null;
                    }),
              child: Text(context.ft('Cancel')),
            ),
          ],
          if (message != null) Text(context.ft(message!)),
          if (busy) const LinearProgressIndicator(),
        ],
      ),
    ),
  );
}
