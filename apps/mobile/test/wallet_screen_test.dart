import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/models/bank_account.dart';
import 'package:ticash/localization/app_localizations.dart';
import 'package:ticash/providers/bank_accounts_provider.dart';
import 'package:ticash/screens/wallet/wallet_screen.dart';
import 'package:ticash/services/bank_accounts_service.dart';

class _FakeBankAccountsService extends BankAccountsService {
  _FakeBankAccountsService() : super(dio: Dio());

  @override
  Future<List<BankAccount>> list() async => const [];
}

void main() {
  testWidgets('shows empty bank state and keeps entered bank fields obscured', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          bankAccountsServiceProvider.overrideWithValue(
            _FakeBankAccountsService(),
          ),
        ],
        child: const AppLocalizationScope(
          language: AppLanguage.english,
          child: MaterialApp(home: WalletScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No bank accounts yet'), findsOneWidget);
    await tester.tap(find.text('Add bank account'));
    await tester.pumpAndSettle();

    expect(find.text('Add U.S. bank account'), findsOneWidget);
    final fields = tester.widgetList<EditableText>(find.byType(EditableText));
    expect(fields.where((field) => field.obscureText), hasLength(3));
    expect(find.text('Submit securely'), findsOneWidget);
  });
}
