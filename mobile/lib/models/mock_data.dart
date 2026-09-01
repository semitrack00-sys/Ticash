import 'transaction.dart';
import 'user.dart';

/// Realistic mock data used while the real API integration is pending.
///
/// Amounts and names intentionally match the TiCash Floot mockup so the
/// home screen renders exactly as designed.
class MockData {
  MockData._();

  static const TicashUser user = TicashUser(
    id: 'user-1',
    firstName: 'Alex',
    lastName: 'Louis',
    availableBalance: 2485.60,
    currency: 'USD',
    kycStatus: KycStatus.approved,
  );

  static final List<Transaction> transactions = [
    Transaction(
      id: 'txn-1',
      type: TransactionType.moncashTransfer,
      amount: -125.00,
      status: TransactionStatus.completed,
      createdAt: DateTime(2024, 5, 12, 9, 30),
      recipient: const Recipient(name: 'Marie J.', country: 'Haiti'),
    ),
    Transaction(
      id: 'txn-2',
      type: TransactionType.walletDeposit,
      amount: 300.00,
      status: TransactionStatus.completed,
      createdAt: DateTime(2024, 5, 11, 14, 5),
      source: 'Visa •••• 2048',
    ),
    Transaction(
      id: 'txn-3',
      type: TransactionType.natcashTransfer,
      amount: -80.00,
      status: TransactionStatus.completed,
      createdAt: DateTime(2024, 5, 10, 18, 45),
      recipient: const Recipient(name: 'Jean P.', country: 'Haiti'),
    ),
    Transaction(
      id: 'txn-4',
      type: TransactionType.moncashTransfer,
      amount: -60.00,
      status: TransactionStatus.pending,
      createdAt: DateTime(2024, 5, 9, 8, 15),
      recipient: const Recipient(name: 'Nadege R.', country: 'Haiti'),
    ),
    Transaction(
      id: 'txn-5',
      type: TransactionType.walletDeposit,
      amount: 500.00,
      status: TransactionStatus.completed,
      createdAt: DateTime(2024, 5, 7, 11, 0),
      source: 'Visa •••• 2048',
    ),
  ];

  /// Countries featured in the "Send abroad" promo, with flag emoji.
  static const List<Map<String, String>> sendAbroadCountries = [
    {'flag': '🇭🇹', 'name': 'Haiti'},
    {'flag': '🇸🇳', 'name': 'Senegal'},
    {'flag': '🇬🇲', 'name': 'Gambia'},
    {'flag': '🇬🇳', 'name': 'Guinea'},
  ];
}
