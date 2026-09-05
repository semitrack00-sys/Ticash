import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/theme.dart';
import '../../localization/app_localizations.dart';
import '../../models/recipient.dart';
import '../../providers/recipients_provider.dart';
import '../../widgets/app_shell.dart';

class RecipientsScreen extends ConsumerStatefulWidget {
  const RecipientsScreen({super.key});
  @override
  ConsumerState<RecipientsScreen> createState() => _RecipientsScreenState();
}

class _RecipientsScreenState extends ConsumerState<RecipientsScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(recipientsProvider);
    return AppShell(
      currentIndex: 1,
      title: context.tr('recipients'),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddRecipient(context),
        backgroundColor: AppTheme.gold,
        foregroundColor: AppTheme.navy,
        icon: const Icon(Icons.person_add_alt_1_rounded),
        label: Text(context.tr('addRecipient')),
      ),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off_outlined, size: 48),
                const SizedBox(height: 14),
                Text(context.tr('recipientsLoadFailed')),
                const SizedBox(height: 14),
                OutlinedButton(
                  onPressed: () => ref.read(recipientsProvider.notifier).load(),
                  child: Text(context.tr('tryAgain')),
                ),
              ],
            ),
          ),
        ),
        data: (recipients) {
          final filtered = recipients
              .where(
                (item) =>
                    item.fullName.toLowerCase().contains(
                      _query.toLowerCase(),
                    ) ||
                    item.phoneNumber.contains(_query),
              )
              .toList();
          return RefreshIndicator(
            onRefresh: () => ref.read(recipientsProvider.notifier).load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 22, 20, 100),
              children: [
                Text(
                  context.tr('peopleYouSupport'),
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  context.tr('recipientsSubtitle'),
                  style: const TextStyle(color: AppTheme.muted),
                ),
                const SizedBox(height: 20),
                TextField(
                  onChanged: (value) => setState(() => _query = value),
                  decoration: InputDecoration(
                    hintText: context.tr('searchNamePhone'),
                    prefixIcon: const Icon(Icons.search_rounded),
                  ),
                ),
                const SizedBox(height: 18),
                if (filtered.isEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(30),
                      child: Column(
                        children: [
                          const Icon(
                            Icons.people_outline,
                            size: 48,
                            color: AppTheme.muted,
                          ),
                          const SizedBox(height: 14),
                          Text(
                            recipients.isEmpty
                                ? context.tr('noRecipients')
                                : context.tr('noMatchingRecipients'),
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                        ],
                      ),
                    ),
                  )
                else
                  ...filtered.map(
                    (recipient) => Card(
                      margin: const EdgeInsets.only(bottom: 10),
                      child: ListTile(
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        leading: CircleAvatar(
                          backgroundColor: const Color(0xFFFFF4D6),
                          foregroundColor: AppTheme.navy,
                          child: Text(
                            recipient.fullName.substring(0, 1).toUpperCase(),
                          ),
                        ),
                        title: Text(
                          recipient.fullName,
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        subtitle: Text(
                          '${recipient.payoutMethod ?? context.tr('walletGeneric')} • ${recipient.phoneNumber}\n'
                          '${recipient.city}, ${recipient.department}',
                        ),
                        isThreeLine: true,
                        trailing: PopupMenuButton<String>(
                          onSelected: (value) {
                            if (value == 'edit') {
                              _showAddRecipient(context, recipient);
                            } else if (value == 'delete') {
                              _deleteRecipient(
                                context,
                                recipient.id,
                                recipient.fullName,
                              );
                            }
                          },
                          itemBuilder: (_) => [
                            PopupMenuItem(
                              value: 'edit',
                              child: Row(
                                children: [
                                  const Icon(Icons.edit_outlined),
                                  const SizedBox(width: 10),
                                  Text(context.tr('edit')),
                                ],
                              ),
                            ),
                            PopupMenuItem(
                              value: 'delete',
                              child: Row(
                                children: [
                                  const Icon(
                                    Icons.delete_outline,
                                    color: AppTheme.error,
                                  ),
                                  const SizedBox(width: 10),
                                  Text(context.tr('delete')),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _deleteRecipient(
    BuildContext context,
    String id,
    String name,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('deleteRecipient')),
        content: Text(context.tr('removeRecipient', {'name': name})),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.tr('cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(context.tr('delete')),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(recipientsProvider.notifier).removeRecipient(id);
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('recipientNotDeleted'))),
        );
      }
    }
  }

  Future<void> _showAddRecipient(
    BuildContext context, [
    Recipient? existing,
  ]) async {
    final formKey = GlobalKey<FormState>();
    final name = TextEditingController(text: existing?.fullName);
    final phone = TextEditingController(text: existing?.phoneNumber ?? '+509');
    final address = TextEditingController(text: existing?.address);
    final city = TextEditingController(text: existing?.city);
    var payoutMethod = existing?.payoutMethod ?? 'MONCASH';
    var department = existing?.department.isNotEmpty == true
        ? existing!.department
        : 'Ouest';
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            0,
            20,
            MediaQuery.viewInsetsOf(context).bottom + 24,
          ),
          child: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    existing == null
                        ? context.tr('addRecipient')
                        : context.tr('editRecipient'),
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 18),
                  TextFormField(
                    controller: name,
                    textCapitalization: TextCapitalization.words,
                    decoration: InputDecoration(
                      labelText: context.tr('fullName'),
                    ),
                    validator: (value) => value == null || value.trim().isEmpty
                        ? context.tr('required')
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: phone,
                    keyboardType: TextInputType.phone,
                    decoration: InputDecoration(
                      labelText: context.tr('haitiPhone'),
                    ),
                    validator: (value) =>
                        RegExp(r'^\+509\d{8}$').hasMatch(value?.trim() ?? '')
                        ? null
                        : 'Use +509XXXXXXXX',
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: address,
                    decoration: InputDecoration(
                      labelText: context.tr('streetAddress'),
                    ),
                    validator: (value) =>
                        value == null || value.trim().length < 3
                        ? context.tr('required')
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: city,
                    decoration: InputDecoration(labelText: context.tr('city')),
                    validator: (value) =>
                        value == null || value.trim().length < 2
                        ? context.tr('required')
                        : null,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: department,
                    decoration: InputDecoration(
                      labelText: context.tr('department'),
                    ),
                    items:
                        const [
                              'Artibonite',
                              'Centre',
                              "Grand'Anse",
                              'Nippes',
                              'Nord',
                              'Nord-Est',
                              'Nord-Ouest',
                              'Ouest',
                              'Sud',
                              'Sud-Est',
                            ]
                            .map(
                              (item) => DropdownMenuItem(
                                value: item,
                                child: Text(item),
                              ),
                            )
                            .toList(),
                    onChanged: (value) =>
                        setSheetState(() => department = value ?? department),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: payoutMethod,
                    decoration: InputDecoration(
                      labelText: context.tr('deliveryWallet'),
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: 'MONCASH',
                        child: Text('MonCash'),
                      ),
                      DropdownMenuItem(
                        value: 'NATCASH',
                        child: Text('NatCash'),
                      ),
                    ],
                    onChanged: (value) => setSheetState(
                      () => payoutMethod = value ?? payoutMethod,
                    ),
                  ),
                  const SizedBox(height: 22),
                  ElevatedButton(
                    onPressed: () async {
                      if (!formKey.currentState!.validate()) return;
                      try {
                        if (existing == null) {
                          await ref
                              .read(recipientsProvider.notifier)
                              .addRecipient(
                                fullName: name.text.trim(),
                                phoneNumber: phone.text.trim(),
                                payoutMethod: payoutMethod,
                                address: address.text.trim(),
                                city: city.text.trim(),
                                department: department,
                              );
                        } else {
                          await ref
                              .read(recipientsProvider.notifier)
                              .updateRecipient(
                                recipientId: existing.id,
                                fullName: name.text.trim(),
                                phoneNumber: phone.text.trim(),
                                payoutMethod: payoutMethod,
                                address: address.text.trim(),
                                city: city.text.trim(),
                                department: department,
                              );
                        }
                        if (sheetContext.mounted) Navigator.pop(sheetContext);
                      } catch (_) {
                        if (sheetContext.mounted) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            SnackBar(
                              content: Text(context.tr('recipientSaveFailed')),
                            ),
                          );
                        }
                      }
                    },
                    child: Text(
                      existing == null
                          ? context.tr('saveRecipient')
                          : context.tr('saveChanges'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    name.dispose();
    phone.dispose();
    address.dispose();
    city.dispose();
  }
}
