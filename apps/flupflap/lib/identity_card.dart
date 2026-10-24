import 'package:flutter/material.dart';
import 'native_actions.dart';
import 'session.dart';

class IdentityCard extends StatefulWidget {
  const IdentityCard({super.key, required this.session});
  final FlupFlapSession session;
  @override
  State<IdentityCard> createState() => _IdentityCardState();
}

class _IdentityCardState extends State<IdentityCard> with WidgetsBindingObserver {
  bool enabled = false, consent = false, busy = false;
  String status = 'NOT_STARTED';
  String? message;
  @override
  void initState() { super.initState(); WidgetsBinding.instance.addObserver(this); refresh(); }
  @override
  void dispose() { WidgetsBinding.instance.removeObserver(this); super.dispose(); }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !busy) refresh();
  }
  Future<void> refresh() async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final response = await widget.session.dio.get('/flupflap/identity');
      if (mounted) setState(() {
        enabled = response.data['enabled'] == true;
        status = response.data['status'] as String? ?? 'NOT_STARTED';
        message = null;
      });
    } catch (_) {
      if (mounted && enabled) setState(() => message = 'Unable to refresh verification. Please try again.');
    } finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> start() async {
    if (!consent || busy) return;
    setState(() { busy = true; message = null; });
    try {
      final response = await widget.session.dio.post('/flupflap/identity/session', data: {'consent': true});
      final url = response.data['url'] as String?;
      if (url != null) await NativeActions.identity(Uri.parse(url));
      if (mounted) setState(() => status = response.data['status'] as String? ?? 'PENDING');
    } catch (_) {
      if (mounted) setState(() => message = 'Unable to start. Verify your email and phone first, or contact contact@ticash-app.com for help.');
    } finally { if (mounted) setState(() => busy = false); }
  }
  String get label => switch (status) {
    'APPROVED' => 'Identity verified',
    'IN_REVIEW' => 'Identity verification needs review',
    'DECLINED' => 'Identity verification was not approved. Contact support.',
    'EXPIRED' => 'Identity verification expired',
    'PENDING' => 'Identity verification in progress',
    _ => 'Verify your identity',
  };
  @override
  Widget build(BuildContext context) {
    if (!enabled) return const SizedBox.shrink();
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(label, style: Theme.of(context).textTheme.titleMedium),
        const Text('For higher spending or a security review, verify your government ID and selfie with Didit. Card and purchase checks still apply.'),
        if (status != 'APPROVED') ...[
          CheckboxListTile(contentPadding: EdgeInsets.zero, value: consent,
            onChanged: busy ? null : (v) => setState(() => consent = v ?? false),
            title: const Text('I agree to continue to Didit for ID and selfie verification.'),
            subtitle: const Text('Didit processes your documents and biometric checks. FlupFlap receives verification results. Review the provider notice before submitting your information.')),
          FilledButton(onPressed: consent && !busy ? start : null,
            child: Text(status == 'PENDING' || status == 'IN_REVIEW' ? 'Continue verification' : 'Verify identity')),
        ],
        TextButton(onPressed: busy ? null : refresh, child: const Text('Refresh verification')),
        if (message != null) Text(message!),
        if (busy) const LinearProgressIndicator(),
      ],
    )));
  }
}
