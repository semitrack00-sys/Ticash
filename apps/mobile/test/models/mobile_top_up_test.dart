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

  test('parses supported countries and operator country codes', () {
    final country = MobileTopUpCountry.fromJson({
      'code': 'jm',
      'name': 'Jamaica',
    });
    final operator = MobileTopUpOperator.fromJson({
      'id': 77,
      'name': 'Digicel Jamaica',
      'countryCode': 'jm',
      'bundle': false,
    });
    expect(country.code, 'JM');
    expect(country.name, 'Jamaica');
    expect(operator.countryCode, 'JM');
  });

  test('keeps legacy Haiti records backward compatible without countryCode', () {
    final recipient = MobileTopUpRecipient.fromJson({
      'id': 'recipient-id',
      'nickname': 'Mom',
      'phone': '+50937123456',
    });
    final quote = MobileTopUpQuote.fromJson({
      'id': 'quote-id',
      'recipientPhone': '+50937123456',
      'operatorId': 99,
      'operatorName': 'Provider Haiti Sandbox',
      'productId': 'reloadly:HT:99:airtime:5.00',
      'productName': 'Airtime',
      'kind': 'AIRTIME',
      'providerAmount': 5,
      'providerCurrency': 'USD',
      'deliveredCurrency': 'HTG',
      'feeUsd': 0.5,
      'totalChargeUsd': 5.5,
      'expiresAt': '2026-09-06T12:05:00.000Z',
    });
    expect(recipient.countryCode, 'HT');
    expect(quote.countryCode, 'HT');
  });

  test('uses product country codes when newer worldwide quotes omit countryCode', () {
    final quote = MobileTopUpQuote.fromJson({
      'id': 'quote-id',
      'recipientPhone': '+18765551234',
      'operatorId': 77,
      'operatorName': 'Digicel Jamaica',
      'productId': 'reloadly:JM:77:airtime:7.50',
      'productName': 'Airtime',
      'kind': 'AIRTIME',
      'providerAmount': 7.5,
      'providerCurrency': 'USD',
      'deliveredCurrency': 'JMD',
      'feeUsd': 0.5,
      'totalChargeUsd': 8,
      'expiresAt': '2026-09-06T12:05:00.000Z',
    });
    expect(quote.countryCode, 'JM');
  });

  test('parses an authoritative delivered sandbox receipt', () {
    final transaction = MobileTopUpTransaction.fromJson({
      'id': 'topup-id',
      'recipientPhone': '+50937123456',
      'countryCode': 'jm',
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
    expect(transaction.countryCode, 'JM');
    expect(transaction.testMode, isTrue);
    expect(transaction.totalChargeUsd, 5.5);
  });

  test('keeps legacy Haiti transactions backward compatible without countryCode', () {
    final transaction = MobileTopUpTransaction.fromJson({
      'id': 'legacy-topup-id',
      'recipientPhone': '+50937123456',
      'operatorName': 'Provider Haiti Sandbox',
      'productName': 'Airtime',
      'kind': 'AIRTIME',
      'providerAmount': 5,
      'providerCurrency': 'USD',
      'deliveredCurrency': 'HTG',
      'feeUsd': 0.5,
      'totalChargeUsd': 5.5,
      'status': 'DELIVERED',
      'testMode': true,
      'createdAt': '2026-09-06T12:00:00.000Z',
    });
    expect(transaction.countryCode, 'HT');
  });

  test('allows unknown transaction country data without crashing', () {
    final transaction = MobileTopUpTransaction.fromJson({
      'id': 'unknown-topup-id',
      'recipientPhone': '+18765551234',
      'operatorName': 'Digicel Jamaica',
      'productName': 'Airtime',
      'kind': 'AIRTIME',
      'providerAmount': 5,
      'providerCurrency': 'USD',
      'deliveredCurrency': 'JMD',
      'feeUsd': 0.5,
      'totalChargeUsd': 5.5,
      'status': 'DELIVERED',
      'testMode': true,
      'createdAt': '2026-09-06T12:00:00.000Z',
    });
    expect(transaction.countryCode, isNull);
  });
}
