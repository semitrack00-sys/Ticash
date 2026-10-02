import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ticash/localization/app_localizations.dart';
import 'checkout_contract.dart';
import 'native_actions.dart';
import 'parity_strings.dart';
import 'session.dart';

class AccountParity extends StatefulWidget {
  const AccountParity({
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
  State<AccountParity> createState() => _AccountParityState();
}

class _AccountParityState extends State<AccountParity> {
  ReferralShare? share;
  bool busy = false;
  String? feedback;
  Future<void> load() async {
    if (widget.session.guest || busy) return;
    setState(() => busy = true);
    try {
      final data = await widget.client.share(guest: widget.session.guest);
      if (mounted && !widget.session.guest) setState(() => share = data);
    } catch (_) {
      if (mounted) setState(() => feedback = 'requestFailed');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> send(String target) async {
    if (share == null) return;
    try {
      await NativeActions.share(
        context.ft('shareMessage', {'code': share!.code, 'url': share!.url}),
        target: target,
      );
    } catch (_) {
      if (mounted) setState(() => feedback = 'requestFailed');
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      DropdownButtonFormField<AppLanguage>(
        initialValue: widget.language,
        isExpanded: true,
        decoration: InputDecoration(labelText: context.tr('language')),
        items: AppLanguage.values
            .map((l) => DropdownMenuItem(value: l, child: Text(l.nativeName)))
            .toList(),
        onChanged: (v) {
          if (v != null) widget.onLanguage(v);
        },
      ),
      const SizedBox(height: 16),
      if (widget.session.guest)
        Column(
          children: [
            Text(context.ft('accountRequired')),
            TextButton(
              onPressed: () async {
                await widget.session.logout();
              },
              child: Text(context.ft('Create an account')),
            ),
          ],
        )
      else
        ExpansionTile(
          title: Text(context.ft('share')),
          onExpansionChanged: (open) {
            if (open && share == null) load();
          },
          children: [
            if (busy) const LinearProgressIndicator(),
            if (share != null) ...[
              SelectableText('${context.ft('referral')}: ${share!.code}'),
              SelectableText(share!.url),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Image.memory(
                  share!.qr,
                  width: 180,
                  height: 180,
                  semanticLabel: context.ft('qr'),
                  errorBuilder: (_, __, ___) =>
                      Text(context.ft('requestFailed')),
                ),
              ),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.center,
                children: [
                  TextButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: share!.url));
                      if (mounted) setState(() => feedback = 'copied');
                    },
                    icon: const Icon(Icons.copy),
                    label: Text(context.ft('copy')),
                  ),
                  TextButton.icon(
                    onPressed: () => send('share'),
                    icon: const Icon(Icons.share),
                    label: Text(context.ft('share')),
                  ),
                  TextButton(
                    onPressed: () => send('whatsapp'),
                    child: const Text('WhatsApp'),
                  ),
                  TextButton(
                    onPressed: () => send('sms'),
                    child: const Text('SMS'),
                  ),
                ],
              ),
            ] else if (!busy)
              TextButton(onPressed: load, child: Text(context.ft('retry'))),
          ],
        ),
      if (feedback != null) Text(context.ft(feedback!)),
      const SizedBox(height: 16),
    ],
  );
}
