import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config/routes.dart';
import '../../config/theme.dart';
import '../../models/bank_account.dart';
import '../../providers/bank_accounts_provider.dart';
import '../../widgets/app_navigation_bar.dart';

class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen>
    with WidgetsBindingObserver {
  String? _busyAccountId;
  bool _adding = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ref.invalidate(bankAccountsProvider);
    }
  }

  Future<void> _refresh() async {
    ref.invalidate(bankAccountsProvider);
    await ref.read(bankAccountsProvider.future);
  }

  String _message(Object error) {
    if (error is DioException) {
      final body = error.response?.data;
      if (body is Map<String, dynamic>) {
        final message = body['error'];
        if (message is String && message.isNotEmpty) return message;
      }
      if (error.response?.statusCode == 503) {
        return 'Dwolla Sandbox bank connections are currently disabled.';
      }
    }
    return 'The bank request could not be completed. Please try again.';
  }

  void _notice(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? AppTheme.error : AppTheme.navy,
      ),
    );
  }

  Future<void> _addBank() async {
    final input = await showModalBottomSheet<_BankInput>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const _AddBankSheet(),
    );
    if (input == null || _adding) return;
    setState(() => _adding = true);
    try {
      final service = ref.read(bankAccountsServiceProvider);
      final account = await service.add(
        accountHolderName: input.accountHolderName,
        routingNumber: input.routingNumber,
        accountNumber: input.accountNumber,
        accountType: input.accountType,
      );
      await service.startVerification(account.id);
      await _refresh();
      _notice(
        'Bank added. Check for two small Sandbox deposits, then verify the amounts.',
      );
    } catch (error) {
      _notice(_message(error), error: true);
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  Future<void> _verify(BankAccount account) async {
    final amounts = await showDialog<_MicroDepositInput>(
      context: context,
      builder: (_) => _VerifyMicroDepositsDialog(account: account),
    );
    if (amounts == null) return;
    setState(() => _busyAccountId = account.id);
    try {
      await ref
          .read(bankAccountsServiceProvider)
          .verify(
            id: account.id,
            amount1: amounts.amount1,
            amount2: amounts.amount2,
          );
      await _refresh();
      _notice('Bank account verified.');
    } catch (error) {
      await _refresh().catchError((_) {});
      _notice(_message(error), error: true);
    } finally {
      if (mounted) setState(() => _busyAccountId = null);
    }
  }

  Future<void> _setDefault(BankAccount account) async {
    setState(() => _busyAccountId = account.id);
    try {
      await ref.read(bankAccountsServiceProvider).setDefault(account.id);
      await _refresh();
      _notice('Default bank updated.');
    } catch (error) {
      _notice(_message(error), error: true);
    } finally {
      if (mounted) setState(() => _busyAccountId = null);
    }
  }

  Future<void> _remove(BankAccount account) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Disconnect bank?'),
        content: Text(
          'This removes ${account.bankName ?? account.name} •••• ${account.lastFour} from TiCash. A bank with pending ACH funding cannot be removed.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _busyAccountId = account.id);
    try {
      await ref.read(bankAccountsServiceProvider).remove(account.id);
      await _refresh();
      _notice('Bank disconnected.');
    } catch (error) {
      _notice(_message(error), error: true);
    } finally {
      if (mounted) setState(() => _busyAccountId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final accounts = ref.watch(bankAccountsProvider);
    return Scaffold(
      appBar: const AppNavigationBar(title: 'Bank accounts'),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: AppTheme.navy,
                borderRadius: BorderRadius.circular(22),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.account_balance_rounded,
                    color: AppTheme.gold,
                    size: 30,
                  ),
                  SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'U.S. bank funding',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 7),
                        Text(
                          'Dwolla Sandbox only. TiCash displays masked bank details and never stores full account numbers on this device.',
                          style: TextStyle(
                            color: Color(0xFFCBD5E1),
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Connected banks',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                FilledButton.icon(
                  onPressed: _adding ? null : _addBank,
                  icon: _adding
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.add),
                  label: const Text('Add bank'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            accounts.when(
              loading: () => const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, _) =>
                  _BankError(message: _message(error), onRetry: _refresh),
              data: (items) => items.isEmpty
                  ? _EmptyBanks(onAdd: _addBank)
                  : Column(
                      children: items
                          .map(
                            (account) => Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: _BankCard(
                                account: account,
                                busy: _busyAccountId == account.id,
                                onVerify: () => _verify(account),
                                onSetDefault: () => _setDefault(account),
                                onRemove: () => _remove(account),
                              ),
                            ),
                          )
                          .toList(),
                    ),
            ),
            const SizedBox(height: 12),
            const Card(
              child: Padding(
                padding: EdgeInsets.all(18),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.shield_outlined, color: AppTheme.success),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'ACH funding stays pending until Dwolla confirms settlement. Adding a bank never increases your TiCash balance or starts a Haiti payout.',
                        style: TextStyle(height: 1.4),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => context.go(AppRoutes.transfer),
              icon: const Icon(Icons.send_outlined),
              label: const Text('Continue to Send Money'),
            ),
          ],
        ),
      ),
    );
  }
}

class _BankCard extends StatelessWidget {
  const _BankCard({
    required this.account,
    required this.busy,
    required this.onVerify,
    required this.onSetDefault,
    required this.onRemove,
  });

  final BankAccount account;
  final bool busy;
  final VoidCallback onVerify;
  final VoidCallback onSetDefault;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (account.status) {
      BankVerificationStatus.verified => AppTheme.success,
      BankVerificationStatus.failed => AppTheme.error,
      BankVerificationStatus.removed => AppTheme.muted,
      BankVerificationStatus.pending => const Color(0xFF9A6700),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF4D6),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(
                    Icons.account_balance_rounded,
                    color: AppTheme.navy,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        account.bankName ?? account.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${_title(account.accountType)} •••• ${account.lastFour}',
                        style: const TextStyle(color: AppTheme.muted),
                      ),
                    ],
                  ),
                ),
                if (busy)
                  const SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else
                  PopupMenuButton<String>(
                    onSelected: (value) {
                      if (value == 'default') onSetDefault();
                      if (value == 'remove') onRemove();
                    },
                    itemBuilder: (_) => [
                      if (account.status == BankVerificationStatus.verified &&
                          !account.isDefault)
                        const PopupMenuItem(
                          value: 'default',
                          child: Text('Make default'),
                        ),
                      const PopupMenuItem(
                        value: 'remove',
                        child: Text('Disconnect bank'),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    _title(account.status.name),
                    style: TextStyle(
                      color: statusColor,
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                    ),
                  ),
                ),
                if (account.isDefault) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF4D6),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Text(
                      'Default',
                      style: TextStyle(
                        color: AppTheme.navy,
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
                const Spacer(),
                if (account.canVerify)
                  TextButton(
                    onPressed: busy ? null : onVerify,
                    child: const Text('Verify deposits'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _title(String value) => value.isEmpty
      ? value
      : '${value.substring(0, 1).toUpperCase()}${value.substring(1).toLowerCase()}';
}

class _EmptyBanks extends StatelessWidget {
  const _EmptyBanks({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        children: [
          const Icon(
            Icons.account_balance_outlined,
            size: 44,
            color: AppTheme.muted,
          ),
          const SizedBox(height: 12),
          const Text(
            'No bank accounts yet',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18),
          ),
          const SizedBox(height: 7),
          const Text(
            'Add and verify a U.S. checking or savings account for Sandbox ACH testing.',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 18),
          OutlinedButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.add),
            label: const Text('Add bank account'),
          ),
        ],
      ),
    ),
  );
}

class _BankError extends StatelessWidget {
  const _BankError({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(22),
      child: Column(
        children: [
          const Icon(Icons.cloud_off_outlined, color: AppTheme.error, size: 34),
          const SizedBox(height: 10),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 14),
          OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}

class _BankInput {
  const _BankInput({
    required this.accountHolderName,
    required this.routingNumber,
    required this.accountNumber,
    required this.accountType,
  });

  final String accountHolderName;
  final String routingNumber;
  final String accountNumber;
  final String accountType;
}

class _AddBankSheet extends StatefulWidget {
  const _AddBankSheet();

  @override
  State<_AddBankSheet> createState() => _AddBankSheetState();
}

class _AddBankSheetState extends State<_AddBankSheet> {
  final _formKey = GlobalKey<FormState>();
  final _holder = TextEditingController();
  final _routing = TextEditingController();
  final _account = TextEditingController();
  final _confirm = TextEditingController();
  String _type = 'checking';

  @override
  void dispose() {
    _holder.dispose();
    _routing.dispose();
    _account.dispose();
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      20,
      12,
      20,
      MediaQuery.viewInsetsOf(context).bottom + 24,
    ),
    child: SingleChildScrollView(
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: AppTheme.border,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 18),
            Text(
              'Add U.S. bank account',
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 8),
            const Text(
              'Your bank details are submitted securely to the TiCash backend and are not saved on this device.',
              style: TextStyle(color: AppTheme.muted, height: 1.4),
            ),
            const SizedBox(height: 20),
            TextFormField(
              controller: _holder,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [],
              decoration: const InputDecoration(
                labelText: 'Account-holder name',
                prefixIcon: Icon(Icons.person_outline),
              ),
              validator: (value) => (value?.trim().length ?? 0) < 2
                  ? 'Enter the account-holder name'
                  : null,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: const InputDecoration(
                labelText: 'Account type',
                prefixIcon: Icon(Icons.account_balance_outlined),
              ),
              items: const [
                DropdownMenuItem(value: 'checking', child: Text('Checking')),
                DropdownMenuItem(value: 'savings', child: Text('Savings')),
              ],
              onChanged: (value) => setState(() => _type = value ?? 'checking'),
            ),
            const SizedBox(height: 12),
            _SecureBankField(
              controller: _routing,
              label: '9-digit routing number',
              length: 9,
            ),
            const SizedBox(height: 12),
            _SecureBankField(
              controller: _account,
              label: 'Account number',
              minLength: 4,
              maxLength: 17,
            ),
            const SizedBox(height: 12),
            _SecureBankField(
              controller: _confirm,
              label: 'Confirm account number',
              minLength: 4,
              maxLength: 17,
              validator: (value) => value != _account.text
                  ? 'Account numbers do not match'
                  : null,
            ),
            const SizedBox(height: 16),
            const Text(
              'By continuing, you confirm that you own or are authorized to use this U.S. bank account.',
              style: TextStyle(
                color: AppTheme.muted,
                fontSize: 12,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: () {
                if (!_formKey.currentState!.validate()) return;
                Navigator.pop(
                  context,
                  _BankInput(
                    accountHolderName: _holder.text.trim(),
                    routingNumber: _routing.text,
                    accountNumber: _account.text,
                    accountType: _type,
                  ),
                );
              },
              icon: const Icon(Icons.lock_outline),
              label: const Text('Submit securely'),
            ),
          ],
        ),
      ),
    ),
  );
}

class _SecureBankField extends StatelessWidget {
  const _SecureBankField({
    required this.controller,
    required this.label,
    this.length,
    this.minLength,
    this.maxLength,
    this.validator,
  });

  final TextEditingController controller;
  final String label;
  final int? length;
  final int? minLength;
  final int? maxLength;
  final String? Function(String?)? validator;

  @override
  Widget build(BuildContext context) => TextFormField(
    controller: controller,
    keyboardType: TextInputType.number,
    obscureText: true,
    autocorrect: false,
    enableSuggestions: false,
    autofillHints: const [],
    inputFormatters: [
      FilteringTextInputFormatter.digitsOnly,
      if ((maxLength ?? length) case final int value)
        LengthLimitingTextInputFormatter(value),
    ],
    decoration: InputDecoration(
      labelText: label,
      prefixIcon: const Icon(Icons.lock_outline),
    ),
    validator: (value) {
      final custom = validator?.call(value);
      if (custom != null) return custom;
      final count = value?.length ?? 0;
      if (length != null && count != length) {
        return 'Enter exactly $length digits';
      }
      if (minLength != null && count < minLength!) {
        return 'Enter at least $minLength digits';
      }
      if (maxLength != null && count > maxLength!) {
        return 'Enter no more than $maxLength digits';
      }
      return null;
    },
  );
}

class _MicroDepositInput {
  const _MicroDepositInput(this.amount1, this.amount2);

  final String amount1;
  final String amount2;
}

class _VerifyMicroDepositsDialog extends StatefulWidget {
  const _VerifyMicroDepositsDialog({required this.account});

  final BankAccount account;

  @override
  State<_VerifyMicroDepositsDialog> createState() =>
      _VerifyMicroDepositsDialogState();
}

class _VerifyMicroDepositsDialogState
    extends State<_VerifyMicroDepositsDialog> {
  final _formKey = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _second = TextEditingController();

  @override
  void dispose() {
    _first.dispose();
    _second.dispose();
    super.dispose();
  }

  String? _validate(String? value) {
    if (!RegExp(r'^0\.0[1-9]$').hasMatch(value ?? '')) {
      return 'Use a value from 0.01 to 0.09';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Verify small deposits'),
    content: Form(
      key: _formKey,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Enter the two Dwolla Sandbox deposits for •••• ${widget.account.lastFour}. You have ${3 - widget.account.verificationAttempts} attempts remaining.',
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _first,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'First amount',
              prefixText: r'$ ',
            ),
            validator: _validate,
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _second,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Second amount',
              prefixText: r'$ ',
            ),
            validator: _validate,
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () {
          if (!_formKey.currentState!.validate()) return;
          Navigator.pop(context, _MicroDepositInput(_first.text, _second.text));
        },
        child: const Text('Verify'),
      ),
    ],
  );
}
