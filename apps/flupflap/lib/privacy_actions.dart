import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'native_actions.dart';

const deletionSupportEmail = 'contact@ticash-app.com';

class PrivacyActions extends StatelessWidget {
  const PrivacyActions({super.key});

  Future<void> _open(BuildContext context, String action) async {
    try {
      await NativeActions.privacyAction(action);
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Unable to open. Email contact@ticash-app.com for help.'),
        ));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Card(
    child: Column(children: [
      ListTile(
        leading: const Icon(Icons.privacy_tip_outlined),
        title: const Text('Privacy policy'),
        trailing: const Icon(Icons.open_in_new),
        onTap: () => _open(context, 'policy'),
      ),
      const Divider(height: 1),
      ListTile(
        key: const ValueKey('account-deletion-request'),
        leading: const Icon(Icons.person_remove_outlined),
        title: const Text('Delete my account'),
        subtitle: const Text('Request deletion of your FlupFlap account and associated data'),
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) => const DeletionRequestScreen(),
        )),
      ),
    ]),
  );
}

class DeletionRequestScreen extends StatelessWidget {
  const DeletionRequestScreen({super.key});

  Future<void> _open(BuildContext context, String action) async {
    try {
      await NativeActions.privacyAction(action);
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Unable to open. Copy the email address and send your request manually.'),
        ));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Delete my FlupFlap account')),
    body: ListView(padding: const EdgeInsets.all(24), children: [
      const Text('Request account and data deletion',
        style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
      const SizedBox(height: 16),
      const Text('Email us from the address registered to your FlupFlap account. '
        'Ask to delete your account and associated personal data. If you cannot access '
        'that email address, explain this so support can help verify your request.'),
      const SizedBox(height: 16),
      const SelectableText(deletionSupportEmail),
      const SizedBox(height: 12),
      FilledButton.icon(
        onPressed: () => _open(context, 'deletionEmail'),
        icon: const Icon(Icons.email_outlined),
        label: const Text('Write deletion request'),
      ),
      TextButton(
        onPressed: () async {
          await Clipboard.setData(const ClipboardData(text: deletionSupportEmail));
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Email address copied')),
            );
          }
        },
        child: const Text('Copy email address'),
      ),
      const Text('Opening your email app does not send a request. Review and send '
        'the email yourself. Do not include passwords, payment card details or identity documents.'),
      const SizedBox(height: 16),
      const Text('Support reviews and verifies requests before processing deletion. '
        'Ask support to stop any recurring recharges as part of your request. '
        'Deleting a receipt or signing out does not delete your account. '
        'Certain transaction, security or audit records may need to be retained '
        'for legitimate reasons; support can explain any applicable retention.'),
      const SizedBox(height: 12),
      OutlinedButton(
        onPressed: () => _open(context, 'deletionPage'),
        child: const Text('Open deletion webpage'),
      ),
    ]),
  );
}
