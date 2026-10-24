import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'parity_strings.dart';
import 'session.dart';

class VerificationCard extends StatefulWidget {
  const VerificationCard({super.key, required this.session});
  final FlupFlapSession session;
  @override
  State<VerificationCard> createState() => _VerificationCardState();
}

class _VerificationCardState extends State<VerificationCard> {
  Map<String, dynamic>? availability;
  String? channel, challengeId, message;
  bool busy = false;
  bool smsConsent = false;
  final code = TextEditingController();
  final verified = <String>{};
  @override
  void initState() {
    super.initState();
    load();
  }
  Future<void> load() async {
    try {
      final response = await widget.session.dio.get('/flupflap/verification');
      if (mounted) setState(() => availability = Map<String, dynamic>.from(response.data as Map));
    } catch (_) { /* Optional feature remains hidden when unavailable. */ }
  }
  @override
  void dispose() { code.dispose(); super.dispose(); }
  Future<void> send(String value) async {
    setState(() { busy = true; message = null; });
    try {
      final response = await widget.session.dio.post('/flupflap/verification/send', data: {'channel': value, if (value == 'phone') 'smsConsent': smsConsent});
      if (mounted) {
        setState(() {
          channel = value; challengeId = response.data['challengeId'] as String;
          code.clear(); message = 'verificationSent';
        });
      }
    } catch (_) {
      if (mounted) setState(() => message = 'verificationUnavailable');
    } finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> confirm() async {
    if (challengeId == null || code.text.length != 6) return;
    setState(() { busy = true; message = null; });
    try {
      await widget.session.dio.post('/flupflap/verification/confirm',
        data: {'channel': channel, 'challengeId': challengeId, 'code': code.text});
      if (mounted) {
        setState(() {
          verified.add(channel!); challengeId = null; code.clear(); message = 'verificationComplete';
        });
      }
    } catch (_) {
      if (mounted) setState(() => message = 'verificationInvalid');
    } finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    if (availability?['enabled'] != true) return const SizedBox.shrink();
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(context.ft('verifyContacts'), style: Theme.of(context).textTheme.titleMedium),
        if (availability?['phone'] == true) ...[
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: smsConsent,
            onChanged: busy ? null : (value) => setState(() => smsConsent = value ?? false),
            title: const Text('I agree to receive FlupFlap verification texts at my account phone number when I request a code.'),
            subtitle: const Text('Message frequency varies with your requests. Message and data rates may apply. Reply STOP to opt out or HELP for help. These texts contain only the verification code you request, not marketing. Support: contact@ticash-app.com.'),
          ),
          const SelectableText('Privacy: https://www.flupflap.com/legal/privacy\nTerms: https://www.flupflap.com/legal/terms'),
        ],
        for (final value in ['email', 'phone'])
          if (availability?[value] == true)
            TextButton(
              onPressed: busy || (value == 'phone' && !smsConsent) || verified.contains(value) || widget.session.user?['${value}Verified'] == true
                  ? null : () => send(value),
              child: Text(context.ft(verified.contains(value) || widget.session.user?['${value}Verified'] == true
                  ? 'verificationComplete' : value == 'email' ? 'verifyEmail' : 'verifyPhone')),
            ),
        if (challengeId != null) ...[
          TextField(controller: code, keyboardType: TextInputType.number,
            autofillHints: const [AutofillHints.oneTimeCode], maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(labelText: context.ft('verificationCode'))),
          FilledButton(onPressed: busy ? null : confirm, child: Text(context.ft('verifyCode'))),
        ],
        if (message != null) Text(context.ft(message!)),
        if (busy) const LinearProgressIndicator(),
      ],
    )));
  }
}
