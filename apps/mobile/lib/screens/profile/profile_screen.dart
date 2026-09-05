import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/routes.dart';
import '../../localization/app_localizations.dart';
import '../../models/user.dart';
import '../../providers/auth_provider.dart';
import '../../config/theme.dart';
import '../../widgets/app_shell.dart';
import '../../widgets/language_selector.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  Future<void> _changePassword(BuildContext context, WidgetRef ref) async {
    final current = TextEditingController();
    final next = TextEditingController();
    final confirm = TextEditingController();
    String? error;
    var saving = false;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: Text(context.tr('changePassword')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: current,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: context.tr('currentPassword'),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: next,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: context.tr('newPassword'),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: confirm,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: context.tr('confirmNewPassword'),
                  ),
                ),
                if (error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: Text(context.tr('cancel')),
            ),
            FilledButton(
              onPressed: saving
                  ? null
                  : () async {
                      if (next.text.length < 8) {
                        setState(() => error = context.tr('useAtLeast8'));
                        return;
                      }
                      if (next.text != confirm.text) {
                        setState(
                          () => error = context.tr('passwordsDoNotMatch'),
                        );
                        return;
                      }
                      setState(() {
                        saving = true;
                        error = null;
                      });
                      try {
                        await ref
                            .read(authNotifierProvider.notifier)
                            .changePassword(current.text, next.text);
                        if (dialogContext.mounted) Navigator.pop(dialogContext);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(context.tr('passwordChanged')),
                            ),
                          );
                          await ref
                              .read(authNotifierProvider.notifier)
                              .logout();
                          if (context.mounted) context.go(AppRoutes.login);
                        }
                      } catch (exception) {
                        setState(() {
                          saving = false;
                          error = exception.toString();
                        });
                      }
                    },
              child: saving
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(context.tr('update')),
            ),
          ],
        ),
      ),
    );
    current.dispose();
    next.dispose();
    confirm.dispose();
  }

  Future<void> _editProfile(
    BuildContext context,
    WidgetRef ref,
    User user,
  ) async {
    final firstName = TextEditingController(text: user.firstName);
    final lastName = TextEditingController(text: user.lastName);
    final phone = TextEditingController(text: user.phoneNumber ?? '');
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('editProfile')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: firstName,
                decoration: InputDecoration(labelText: context.tr('firstName')),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: lastName,
                decoration: InputDecoration(labelText: context.tr('lastName')),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: phone,
                keyboardType: TextInputType.phone,
                decoration: InputDecoration(
                  labelText: context.tr('mobilePhone'),
                  hintText: '+12025550144',
                  helperText: context.tr('includeCountryCode'),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.tr('cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(context.tr('save')),
          ),
        ],
      ),
    );
    if (saved == true && context.mounted) {
      try {
        await ref
            .read(authNotifierProvider.notifier)
            .updateProfile(
              firstName: firstName.text,
              lastName: lastName.text,
              phoneNumber: phone.text,
            );
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(context.tr('profileUpdated'))));
        }
      } catch (exception) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(exception.toString())));
        }
      }
    }
    firstName.dispose();
    lastName.dispose();
    phone.dispose();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);
    final user = authState.value;

    return AppShell(
      currentIndex: 3,
      title: context.tr('profile'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 30),
        children: [
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color: AppTheme.navy,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: AppTheme.gold,
                  foregroundColor: AppTheme.navy,
                  child: Text(
                    (user?.firstName.isNotEmpty ?? false)
                        ? user!.firstName.substring(0, 1).toUpperCase()
                        : 'T',
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user?.fullName ?? context.tr('guest'),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        user?.email ?? '',
                        style: const TextStyle(color: Color(0xFFCBD5E1)),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Card(
            child: ListTile(
              leading: const Icon(
                Icons.verified_user_outlined,
                color: AppTheme.gold,
              ),
              title: Text(context.tr('identityReview')),
              subtitle: Text(user?.kycStatus.name ?? context.tr('unknown')),
              trailing: const Icon(Icons.chevron_right),
              onTap: user == null ? null : () => context.go(AppRoutes.kyc),
            ),
          ),
          const SizedBox(height: 20),
          if (user != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.manage_accounts_outlined),
                title: Text(context.tr('personalInformation')),
                subtitle: Text(user.phoneNumber ?? context.tr('addMobile')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _editProfile(context, ref, user),
              ),
            ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.password),
              title: Text(context.tr('changePassword')),
              subtitle: Text(context.tr('changePasswordSubtitle')),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _changePassword(context, ref),
            ),
          ),
          const Card(child: LanguageSelector(compact: false)),
          Card(
            child: ListTile(
              leading: const Icon(Icons.help_outline),
              title: Text(context.tr('helpSafety')),
              subtitle: Text(context.tr('helpSubtitle')),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.go(AppRoutes.support),
            ),
          ),
          if (user?.role == 'ADMIN') ...[
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => context.go(AppRoutes.admin),
              icon: const Icon(Icons.admin_panel_settings),
              label: Text(context.tr('adminDashboard')),
            ),
          ],
          const SizedBox(height: 32),
          OutlinedButton(
            onPressed: () async {
              await ref.read(authNotifierProvider.notifier).logout();
              if (context.mounted) context.go(AppRoutes.login);
            },
            child: Text(context.tr('logOut')),
          ),
        ],
      ),
    );
  }
}
