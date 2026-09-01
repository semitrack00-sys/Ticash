import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/routes.dart';
import '../../providers/auth_provider.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);
    final user = authState.value;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              user?.fullName ?? 'Guest',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            Text(user?.email ?? ''),
            const SizedBox(height: 8),
            Text('KYC status: ${user?.kycStatus.name ?? 'unknown'}'),
            const Spacer(),
            OutlinedButton(
              onPressed: () async {
                await ref.read(authNotifierProvider.notifier).logout();
                if (context.mounted) context.go(AppRoutes.login);
              },
              child: const Text('Log Out'),
            ),
          ],
        ),
      ),
    );
  }
}
