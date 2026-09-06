import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/bank_account.dart';
import '../services/bank_accounts_service.dart';

final bankAccountsServiceProvider = Provider((ref) => BankAccountsService());

final bankAccountsProvider = FutureProvider<List<BankAccount>>((ref) {
  return ref.watch(bankAccountsServiceProvider).list();
});
