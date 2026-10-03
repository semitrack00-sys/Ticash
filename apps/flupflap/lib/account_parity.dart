import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
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
  int epoch = 0;
  String? owner;
  bool get registered => widget.session.authenticated && !widget.session.guest;

  @override
  void initState() {
    super.initState();
    owner = widget.session.user?['id'] as String?;
    widget.session.addListener(sessionChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) load();
    });
  }

  void sessionChanged() {
    final id = widget.session.user?['id'] as String?;
    if (registered && id == owner) return;
    epoch++;
    setState(() {
      owner = id;
      share = null;
      feedback = null;
      busy = false;
    });
    if (registered) load();
  }

  @override
  void dispose() {
    epoch++;
    widget.session.removeListener(sessionChanged);
    super.dispose();
  }

  Future<void> load() async {
    if (!registered || busy) return;
    final request = ++epoch;
    setState(() {
      busy = true;
      feedback = null;
    });
    try {
      final data = await widget.client.share(guest: widget.session.guest);
      if (mounted && request == epoch && registered) {
        setState(() => share = data);
      }
    } catch (_) {
      if (mounted && request == epoch) {
        setState(() => feedback = 'requestFailed');
      }
    } finally {
      if (mounted && request == epoch) setState(() => busy = false);
    }
  }

  Future<void> copy(bool code) async {
    if (!registered || share == null) return;
    try {
      await Clipboard.setData(
        ClipboardData(text: code ? share!.code : share!.url),
      );
      if (mounted) setState(() => feedback = code ? 'codeCopied' : 'copied');
    } catch (_) {
      if (mounted) setState(() => feedback = 'requestFailed');
    }
  }

  Future<void> send(String target) async {
    if (!registered || share == null) return;
    final message = context.ft('shareMessage', {
      'code': share!.code,
      'url': share!.url,
    });
    try {
      await NativeActions.share(message, target: target);
    } on PlatformException {
      // WhatsApp may not be installed; offer Android's standard share sheet.
      if (target == 'whatsapp') {
        try {
          await NativeActions.share(message);
          return;
        } catch (_) {}
      }
      if (mounted) setState(() => feedback = 'requestFailed');
    } catch (_) {
      if (mounted) setState(() => feedback = 'requestFailed');
    }
  }

  Future<void> createAccount() async {
    final router = GoRouter.of(context);
    try {
      await widget.session.logout();
    } catch (_) {
      // Logout clears the local session even if the server is unreachable.
    }
    router.go('/login?register=true');
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
      Card(
        key: const ValueKey('referral-card'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                context.ft('share'),
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              if (!registered) ...[
                Text(context.ft('guestReferral')),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: createAccount,
                  child: Text(context.ft('Create account')),
                ),
              ] else ...[
                Text(context.ft('shareHelp')),
                if (busy)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: LinearProgressIndicator(),
                  ),
                if (share != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    context.ft('referral'),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  SelectableText(
                    share!.code,
                    key: const ValueKey('referral-code'),
                  ),
                  const SizedBox(height: 8),
                  SelectableText(
                    share!.url,
                    key: const ValueKey('referral-link'),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: () => copy(true),
                        icon: const Icon(Icons.copy),
                        label: Text(context.ft('copyCode')),
                      ),
                      OutlinedButton.icon(
                        onPressed: () => copy(false),
                        icon: const Icon(Icons.link),
                        label: Text(context.ft('copyReferralLink')),
                      ),
                      FilledButton.icon(
                        onPressed: () => send('share'),
                        icon: const Icon(Icons.share),
                        label: Text(context.ft('shareAction')),
                      ),
                      OutlinedButton(
                        onPressed: () => send('whatsapp'),
                        child: const Text('WhatsApp'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Center(
                    child: Image.memory(
                      share!.qr,
                      key: const ValueKey('referral-qr'),
                      width: 180,
                      height: 180,
                      semanticLabel: context.ft('qr'),
                      errorBuilder: (_, __, ___) =>
                          Text(context.ft('requestFailed')),
                    ),
                  ),
                  Text(context.ft('qr'), textAlign: TextAlign.center),
                ] else if (!busy)
                  OutlinedButton(
                    onPressed: load,
                    child: Text(context.ft('retry')),
                  ),
              ],
              if (feedback != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Semantics(
                    liveRegion: true,
                    child: Text(context.ft(feedback!)),
                  ),
                ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 16),
    ],
  );
}
