import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/recipients_provider.dart';

class RecipientsScreen extends ConsumerWidget {
  const RecipientsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recipients = ref.watch(recipientsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Recipients')),
      body: recipients.isEmpty
          ? const Center(child: Text('No recipients yet'))
          : ListView.builder(
              itemCount: recipients.length,
              itemBuilder: (context, index) {
                final recipient = recipients[index];
                return ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.person)),
                  title: Text(recipient.fullName),
                  subtitle: Text('${recipient.country} · ${recipient.phoneNumber}'),
                );
              },
            ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        child: const Icon(Icons.add),
      ),
    );
  }
}
