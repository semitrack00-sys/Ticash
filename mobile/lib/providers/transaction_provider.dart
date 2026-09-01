import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/mock_data.dart';
import '../models/transaction.dart';

/// Loads and exposes recent transactions for the "Recent activity" list.
class TransactionsNotifier extends StateNotifier<AsyncValue<List<Transaction>>> {
  TransactionsNotifier() : super(const AsyncValue.loading()) {
    _load();
  }

  Future<void> _load() async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    state = AsyncValue.data(MockData.transactions);
  }

  Future<void> refresh() => _load();
}

final transactionsProvider =
    StateNotifierProvider<TransactionsNotifier, AsyncValue<List<Transaction>>>(
  (ref) => TransactionsNotifier(),
);
