/// Status of a money transfer.
enum TransferStatus {
  pending,
  processing,
  completed,
  failed,
  cancelled,
}

/// A money transfer between a TiCash user and a recipient.
class Transfer {
  final String id;
  final String recipientId;
  final double amount;
  final String sourceCurrency;
  final String targetCurrency;
  final double fee;
  final double exchangeRate;
  final TransferStatus status;
  final DateTime createdAt;

  const Transfer({
    required this.id,
    required this.recipientId,
    required this.amount,
    required this.sourceCurrency,
    required this.targetCurrency,
    required this.fee,
    required this.exchangeRate,
    required this.status,
    required this.createdAt,
  });

  double get totalCost => amount + fee;

  double get amountReceived => amount * exchangeRate;

  factory Transfer.fromJson(Map<String, dynamic> json) {
    return Transfer(
      id: json['id'] as String,
      recipientId: json['recipientId'] as String,
      amount: (json['amount'] as num).toDouble(),
      sourceCurrency: json['sourceCurrency'] as String,
      targetCurrency: json['targetCurrency'] as String,
      fee: (json['fee'] as num).toDouble(),
      exchangeRate: (json['exchangeRate'] as num).toDouble(),
      status: TransferStatus.values.firstWhere(
        (status) => status.name == json['status'],
        orElse: () => TransferStatus.pending,
      ),
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'recipientId': recipientId,
      'amount': amount,
      'sourceCurrency': sourceCurrency,
      'targetCurrency': targetCurrency,
      'fee': fee,
      'exchangeRate': exchangeRate,
      'status': status.name,
      'createdAt': createdAt.toIso8601String(),
    };
  }
}
