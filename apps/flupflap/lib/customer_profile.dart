import 'package:flutter/material.dart';
import 'parity_strings.dart';
import 'package:dio/dio.dart';

/// Only displays fields returned for the authenticated customer.
class CustomerProfileDetails extends StatelessWidget {
  const CustomerProfileDetails({super.key, required this.user, this.onSave});
  final Map<String, dynamic> user;
  final Future<void> Function(String, String, String)? onSave;

  @override
  Widget build(BuildContext context) {
    const fields = {
      'First name': 'firstName',
      'Last name': 'lastName',
      'Email address': 'email',
      'Phone number': 'phone',
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(context.ft('Profile'),
                style: Theme.of(context).textTheme.titleMedium),
            if (onSave != null)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  icon: const Icon(Icons.edit_outlined),
                  label: Text(context.ft('Edit profile')),
                  onPressed: () async {
                    final saved = await showDialog<bool>(
                      context: context,
                      barrierDismissible: false,
                      builder: (_) => _EditProfile(user: user, onSave: onSave!),
                    );
                    if (saved == true && context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(context.ft('Profile updated'))));
                    }
                  },
                ),
              ),
            for (final field in fields.entries) ...[
              const SizedBox(height: 12),
              Text(context.ft(field.key),
                  style: Theme.of(context).textTheme.labelMedium),
              const SizedBox(height: 4),
              SelectableText(
                user[field.value] is String &&
                        (user[field.value] as String).trim().isNotEmpty
                    ? (user[field.value] as String).trim()
                    : '—',
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _EditProfile extends StatefulWidget {
  const _EditProfile({required this.user, required this.onSave});
  final Map<String, dynamic> user;
  final Future<void> Function(String, String, String) onSave;
  @override
  State<_EditProfile> createState() => _EditProfileState();
}

class _EditProfileState extends State<_EditProfile> {
  final form = GlobalKey<FormState>();
  late final first = TextEditingController(text: widget.user['firstName'] as String? ?? '');
  late final last = TextEditingController(text: widget.user['lastName'] as String? ?? '');
  late final phone = TextEditingController(text: widget.user['phone'] as String? ?? '');
  bool saving = false;
  String? error;
  @override
  void dispose() { first.dispose(); last.dispose(); phone.dispose(); super.dispose(); }

  Future<void> save() async {
    if (saving || !form.currentState!.validate()) return;
    setState(() { saving = true; error = null; });
    try {
      await widget.onSave(first.text, last.text, phone.text);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      final code = e is DioException && e.response?.data is Map
          ? (e.response!.data as Map)['code'] : null;
      setState(() {
        saving = false;
        error = code == 'PROFILE_CONTACT_UNAVAILABLE'
            ? 'This phone number cannot be used. Check the number or contact support.'
            : 'Unable to save your profile. Check your connection and try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving,
    child: AlertDialog(
      title: Text(context.ft('Edit profile')),
      content: SingleChildScrollView(
        child: Form(key: form, child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final entry in { 'First name': first, 'Last name': last }.entries)
            Padding(padding: const EdgeInsets.only(bottom: 12), child: TextFormField(
              controller: entry.value, enabled: !saving, maxLength: 80,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(labelText: context.ft(entry.key)),
              validator: (value) => (value ?? '').trim().isEmpty ? context.ft('Required') : null,
            )),
          TextFormField(
            controller: phone, enabled: !saving, maxLength: 16,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(labelText: context.ft('Phone number'), hintText: '+15555550123'),
            validator: (value) => RegExp(r'^\+[1-9]\d{7,14}$').hasMatch((value ?? '').trim())
                ? null : context.ft('Use international format including + and country code.'),
          ),
          Text(context.ft('Changing your phone number requires verifying the new number again.')),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 12),
            child: Text(context.ft(error!), style: TextStyle(color: Theme.of(context).colorScheme.error))),
        ])),
      ),
      actions: [
        TextButton(onPressed: saving ? null : () => Navigator.of(context).pop(false), child: Text(context.ft('Cancel'))),
        FilledButton(onPressed: saving ? null : save, child: Text(context.ft(saving ? 'Saving…' : 'Save profile'))),
      ],
    ),
  );
}
