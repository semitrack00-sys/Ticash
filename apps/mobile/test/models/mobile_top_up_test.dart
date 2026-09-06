import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/models/mobile_top_up.dart';

void main() {
  test(
    'keeps the safety warning unless every live condition is authoritative',
    () {
      final sandbox = MobileTopUpAvailability.fromJson({
        'enabled': true,
        'environment': 'SANDBOX',
        'testMode': true,
        'productionEnabled': false,
        'approvedForLiveUse': false,
        'liveRechargeEnabled': false,
      });
      expect(sandbox.requiresSafetyWarning, isTrue);

      final incompleteProduction = MobileTopUpAvailability.fromJson({
        'enabled': true,
        'environment': 'PRODUCTION',
        'testMode': false,
        'productionEnabled': true,
        'approvedForLiveUse': true,
        'liveRechargeEnabled': false,
      });
      expect(incompleteProduction.requiresSafetyWarning, isTrue);

      final approvedProduction = MobileTopUpAvailability.fromJson({
        'enabled': true,
        'environment': 'PRODUCTION',
        'testMode': false,
        'productionEnabled': true,
        'approvedForLiveUse': true,
        'liveRechargeEnabled': true,
      });
      expect(approvedProduction.requiresSafetyWarning, isFalse);
    },
  );

  test('parses a provider-returned data product', () {
    final product = MobileTopUpProduct.fromJson({
      'id': 'reloadly:99:data:10.00',
      'operatorId': 99,
      'kind': 'DATA',
      'name': '2 GB Sandbox Plan',
      'price': 10,
      'priceCurrency': 'USD',
      'deliveredValue': 1300,
      'deliveredCurrency': 'HTG',
      'amountType': 'FIXED',
    });
    expect(product.kind, MobileTopUpKind.data);
    expect(product.name, '2 GB Sandbox Plan');
    expect(product.price, 10);
    expect(product.deliveredCurrency, 'HTG');
  });

  test('parses an authoritative delivered sandbox receipt', () {
    final transaction = MobileTopUpTransaction.fromJson({
      'id': 'topup-id',
      'recipientPhone': '+50937123456',
      'operatorName': 'Provider Haiti Sandbox',
      'productName': 'Airtime',
      'kind': 'AIRTIME',
      'providerAmount': 5,
      'providerCurrency': 'USD',
      'deliveredValue': 650,
      'deliveredCurrency': 'HTG',
      'feeUsd': 0.5,
      'totalChargeUsd': 5.5,
      'status': 'DELIVERED',
      'testMode': true,
      'createdAt': '2026-09-06T12:00:00.000Z',
      'providerTransactionId': 'reloadly-test-1',
    });
    expect(transaction.status, MobileTopUpStatus.delivered);
    expect(transaction.testMode, isTrue);
    expect(transaction.totalChargeUsd, 5.5);
  });
}
