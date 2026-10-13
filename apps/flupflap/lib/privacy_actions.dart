import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'native_actions.dart';
import 'parity_strings.dart';
import 'session.dart';
import 'package:dio/dio.dart';

const deletionSupportEmail = 'contact@ticash-app.com';

class PrivacyActions extends StatelessWidget {
  const PrivacyActions({super.key, this.session});
  final FlupFlapSession? session;

  Future<void> _open(BuildContext context, String action) async {
    try {
      await NativeActions.privacyAction(action);
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(context.ft('Unable to open. Email contact@ticash-app.com for help.')),
        ));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Card(
    child: Column(children: [
      ListTile(
        leading: const Icon(Icons.privacy_tip_outlined),
        title: Text(context.ft('Privacy policy')),
        trailing: const Icon(Icons.open_in_new),
        onTap: () => _open(context, 'policy'),
      ),
      const Divider(height: 1),
      ListTile(
        key: const ValueKey('account-deletion-request'),
        leading: const Icon(Icons.person_remove_outlined),
        title: Text(context.ft('Delete my account')),
        subtitle: Text(context.ft('Request deletion of your FlupFlap account and associated data')),
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) => session != null && session!.authenticated && !session!.guest
              ? AccountDeletionScreen(session: session!)
              : const DeletionRequestScreen(),
        )),
      ),
    ]),
  );
}

class AccountDeletionScreen extends StatefulWidget {
  const AccountDeletionScreen({super.key, required this.session});
  final FlupFlapSession session;
  @override
  State<AccountDeletionScreen> createState() => _AccountDeletionScreenState();
}

class _AccountDeletionScreenState extends State<AccountDeletionScreen> {
  final password = TextEditingController();
  bool confirmed = false, busy = false;
  String? error;

  @override
  void dispose() { password.dispose(); super.dispose(); }

  Future<void> delete() async {
    if (busy || !confirmed || password.text.isEmpty) return;
    setState(() { busy = true; error = null; });
    try {
      final status = await widget.session.deleteAccount(password.text);
      password.clear();
      if (!mounted) return;
      // Production's router returns to sign-in on session.clear(). This message
      // also gives embedded/test hosts a clear result instead of an email composer.
      setState(() {
        error = status == 'LOCAL_DATA_DELETED'
            ? 'Your account and eligible personal data have been deleted.'
            : 'Deletion accepted. Pending payment work will finish before personal data is erased.';
      });
    } on DioException catch (e) {
      if (!mounted) return;
      final data = e.response?.data;
      final code = data is Map ? data['code'] : null;
      setState(() => error = code == 'DELETION_PASSWORD_INVALID'
          ? 'Your account password is incorrect. Try again.'
          : e.response?.statusCode == 401
              ? 'Please sign in again before deleting your account.'
              : 'Unable to confirm deletion. Check your connection and try again.');
    } catch (_) {
      if (mounted) setState(() => error = 'Unable to confirm deletion. Please try again.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !busy,
    child: Scaffold(
      appBar: AppBar(title: Text(context.ft('Delete my FlupFlap account'))),
      body: ListView(padding: const EdgeInsets.all(24), children: [
        Text(context.ft('Delete account permanently'),
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        Text(context.ft('This stops account access and future automatic recharges. Your profile, saved recipients and eligible personal data will be erased. This cannot be undone.')),
        const SizedBox(height: 12),
        Text(context.ft('Pending payments or recharges must finish safely before personal data deletion completes. Required payment, transaction and security records may be retained as explained in our privacy policy.')),
        const SizedBox(height: 20),
        TextField(
          key: const ValueKey('deletion-password'),
          controller: password, obscureText: true, enabled: !busy,
          enableSuggestions: false, autocorrect: false,
          decoration: InputDecoration(labelText: context.ft('Your FlupFlap password')),
          onChanged: (_) => setState(() {}),
        ),
        CheckboxListTile(
          key: const ValueKey('deletion-confirmation'),
          contentPadding: EdgeInsets.zero, value: confirmed,
          onChanged: busy ? null : (value) => setState(() => confirmed = value == true),
          title: Text(context.ft('I understand and want to permanently delete my account.')),
          controlAffinity: ListTileControlAffinity.leading,
        ),
        if (error != null) Padding(padding: const EdgeInsets.only(bottom: 16),
          child: Text(context.ft(error!), key: const ValueKey('deletion-result'))),
        FilledButton.icon(
          key: const ValueKey('delete-account-submit'),
          style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
          onPressed: busy || !confirmed || password.text.isEmpty || !widget.session.authenticated ? null : delete,
          icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.delete_forever_outlined),
          label: Text(context.ft(busy ? 'Deleting…' : 'Delete account permanently')),
        ),
        TextButton(onPressed: busy ? null : () => Navigator.of(context).pop(),
          child: Text(context.ft('Cancel'))),
      ]),
    ),
  );
}

class DeletionRequestScreen extends StatelessWidget {
  const DeletionRequestScreen({super.key});

  Future<void> _open(BuildContext context, String action) async {
    try {
      await NativeActions.privacyAction(action);
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(context.ft('Unable to open. Copy the email address and send your request manually.')),
        ));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(context.ft('Delete my FlupFlap account'))),
    body: ListView(padding: const EdgeInsets.all(24), children: [
      Text(context.ft('Request account and data deletion'),
        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
      const SizedBox(height: 16),
      Text(context.ft('Email us from the address registered to your FlupFlap account. '
        'Ask to delete your account and associated personal data. If you cannot access '
        'that email address, explain this so support can help verify your request.')),
      const SizedBox(height: 16),
      const SelectableText(deletionSupportEmail),
      const SizedBox(height: 12),
      FilledButton.icon(
        onPressed: () => _open(context, 'deletionEmail'),
        icon: const Icon(Icons.email_outlined),
        label: Text(context.ft('Write deletion request')),
      ),
      TextButton(
        onPressed: () async {
          await Clipboard.setData(const ClipboardData(text: deletionSupportEmail));
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(context.ft('Email address copied'))),
            );
          }
        },
        child: Text(context.ft('Copy email address')),
      ),
      Text(context.ft('Opening your email app does not send a request. Review and send '
        'the email yourself. Do not include passwords, payment card details or identity documents.')),
      const SizedBox(height: 16),
      Text(context.ft('Support reviews and verifies requests before processing deletion. '
        'Ask support to stop any recurring recharges as part of your request. '
        'Deleting a receipt or signing out does not delete your account. '
        'Certain transaction, security or audit records may need to be retained '
        'for legitimate reasons; support can explain any applicable retention.')),
      const SizedBox(height: 12),
      OutlinedButton(
        onPressed: () => _open(context, 'deletionPage'),
        child: Text(context.ft('Open deletion webpage')),
      ),
    ]),
  );
}

