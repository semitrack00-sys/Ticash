import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/theme.dart';
import '../../models/transfer.dart';
import '../../providers/transfer_provider.dart';
import '../../widgets/app_navigation_bar.dart';

class TransactionDetailScreen extends ConsumerStatefulWidget {
  const TransactionDetailScreen({super.key, required this.transferId});
  final String transferId;

  @override
  ConsumerState<TransactionDetailScreen> createState() =>
      _TransactionDetailScreenState();
}

class _TransactionDetailScreenState
    extends ConsumerState<TransactionDetailScreen>
    with WidgetsBindingObserver {
  Transfer? _transfer;
  Object? _error;
  Timer? _poller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _poller = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _load(silent: true),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load({bool silent = false}) async {
    try {
      final transfer = await ref
          .read(transfersServiceProvider)
          .get(widget.transferId);
      if (!mounted) return;
      setState(() {
        _transfer = transfer;
        _error = null;
      });
      if (transfer.stage == TransferStage.delivered ||
          transfer.stage == TransferStage.failed ||
          transfer.stage == TransferStage.reversed ||
          transfer.stage == TransferStage.cancelled) {
        _poller?.cancel();
      }
    } catch (error) {
      if (mounted && !silent) setState(() => _error = error);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poller?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const AppNavigationBar(title: 'Transaction details'),
    body: RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_transfer == null && _error == null)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(48),
                child: CircularProgressIndicator(),
              ),
            )
          else if (_error != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    const Text(
                      'Transaction details are temporarily unavailable.',
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: _load,
                      child: const Text('Try again'),
                    ),
                  ],
                ),
              ),
            )
          else
            _receipt(_transfer!),
        ],
      ),
    ),
  );

  Widget _receipt(Transfer transfer) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (transfer.testMode)
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF4D6),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Text(
            'SANDBOX • No real money moved',
            textAlign: TextAlign.center,
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
        ),
      const SizedBox(height: 16),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              const Icon(
                Icons.receipt_long_rounded,
                size: 42,
                color: AppTheme.gold,
              ),
              const SizedBox(height: 8),
              Text(
                transfer.stage.name
                    .replaceAllMapped(
                      RegExp(r'([A-Z])'),
                      (m) => ' ${m.group(1)}',
                    )
                    .trim(),
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
              ),
              const Divider(height: 30),
              _row('Reference', transfer.referenceNumber),
              _row('Recipient', transfer.recipientName),
              _row('Payout method', transfer.payoutMethod ?? '—'),
              _row(
                'You send',
                '${transfer.amount.toStringAsFixed(2)} ${transfer.sourceCurrency}',
              ),
              _row(
                'Exchange rate',
                '1 ${transfer.sourceCurrency} = ${transfer.exchangeRate.toStringAsFixed(4)} HTG',
              ),
              _row(
                'TiCash fee',
                '${transfer.ticashFee.toStringAsFixed(2)} ${transfer.sourceCurrency}',
              ),
              _row(
                'Funding/provider fee',
                '${transfer.providerFundingFee.toStringAsFixed(2)} ${transfer.sourceCurrency}',
              ),
              _row(
                'Total charged',
                '${transfer.totalCharged.toStringAsFixed(2)} ${transfer.sourceCurrency}',
              ),
              _row(
                'Recipient amount',
                '${transfer.amountReceived.toStringAsFixed(2)} HTG',
              ),
              _row('Created', transfer.createdAt.toLocal().toString()),
              _row('Final status', transfer.status.name.toUpperCase()),
              if (transfer.failureCode != null)
                _row('Failure', transfer.failureCode!),
            ],
          ),
        ),
      ),
    ],
  );

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(label, style: const TextStyle(color: AppTheme.muted)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );
}
