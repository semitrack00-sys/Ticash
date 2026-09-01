import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/transfer.dart';

/// Tracks the in-progress transfer being created by the user (amount,
/// recipient, etc.) as they move through the send-money flow.
class TransferDraft {
  const TransferDraft({
    this.recipientId,
    this.amount = 0,
    this.sourceCurrency = 'USD',
    this.targetCurrency = 'HTG',
  });

  final String? recipientId;
  final double amount;
  final String sourceCurrency;
  final String targetCurrency;

  TransferDraft copyWith({
    String? recipientId,
    double? amount,
    String? sourceCurrency,
    String? targetCurrency,
  }) {
    return TransferDraft(
      recipientId: recipientId ?? this.recipientId,
      amount: amount ?? this.amount,
      sourceCurrency: sourceCurrency ?? this.sourceCurrency,
      targetCurrency: targetCurrency ?? this.targetCurrency,
    );
  }
}

class TransferDraftNotifier extends StateNotifier<TransferDraft> {
  TransferDraftNotifier() : super(const TransferDraft());

  void updateAmount(double amount) {
    state = state.copyWith(amount: amount);
  }

  void selectRecipient(String recipientId) {
    state = state.copyWith(recipientId: recipientId);
  }

  void reset() {
    state = const TransferDraft();
  }
}

final transferDraftProvider =
    StateNotifierProvider<TransferDraftNotifier, TransferDraft>(
  (ref) => TransferDraftNotifier(),
);

final transferHistoryProvider = StateProvider<List<Transfer>>((ref) => []);
