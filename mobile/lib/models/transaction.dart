/// Status of a [Transaction] as shown in the recent activity list.
enum TransactionStatus { completed, pending, failed }

/// The kind of transaction, used to pick an icon/label in the UI.
enum TransactionType { moncashTransfer, natcashTransfer, walletDeposit }

/// A single recipient in the sender's address book.
class Recipient {
  const Recipient({
    required this.name,
    required this.country,
  });

  final String name;
  final String country;
}

/// A single line item shown in "Recent activity" on the home screen.
class Transaction {
  const Transaction({
    required this.id,
    required this.type,
    required this.amount,
    required this.status,
    required this.createdAt,
    this.recipient,
    this.source,
  });

  final String id;
  final TransactionType type;

  /// Positive for money in (deposits), negative for money out (transfers).
  final double amount;
  final TransactionStatus status;
  final DateTime createdAt;

  /// Populated for outgoing transfers (MonCash/NatCash).
  final Recipient? recipient;

  /// Populated for deposits, e.g. "Visa •••• 2048".
  final String? source;

  bool get isCredit => amount > 0;

  String get title {
    switch (type) {
      case TransactionType.moncashTransfer:
        return 'MonCash transfer';
      case TransactionType.natcashTransfer:
        return 'NatCash transfer';
      case TransactionType.walletDeposit:
        return 'Wallet deposit';
    }
  }

  String get subtitle {
    if (recipient != null) {
      return 'To ${recipient!.name} • ${recipient!.country}';
    }
    return source ?? '';
  }

  /// Single-letter avatar initial shown in the transaction row.
  String get avatarInitial {
    if (recipient != null && recipient!.name.isNotEmpty) {
      return recipient!.name.substring(0, 1).toUpperCase();
    }
    return '+';
  }
}
