import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/purchase_access.dart';
import 'package:flupflap/purchase_access_notice.dart';
import 'package:dio/dio.dart';
import 'package:ticash_recharge_core/localization/app_localizations.dart';
import 'checkout_parity_test.dart' show fixture;

Widget shell(Widget child) => AppLocalizationScope(language: AppLanguage.english, child: MaterialApp(home: Scaffold(body: child)));

void main() {
  test('retains server reset time after a purchase rejection', () {
    final (_, _, journey) = fixture();
    final error = DioException(requestOptions: RequestOptions(path: '/payment-sessions'),
      response: Response(requestOptions: RequestOptions(path: '/payment-sessions'), statusCode: 429,
        data: {'code': 'RECHARGE_LIMIT_REACHED', 'purchaseAccess': {'mode': 'TEMPORARY_LIMIT',
          'serverTime': '2026-10-25T12:00:00Z', 'retryAt': '2026-10-25T13:00:00Z'}}));
    expect(journey.safeError(error), 'rechargeLimitReached');
    expect(journey.purchaseAccess?.retryAt, DateTime.utc(2026, 10, 25, 13));
    journey.dispose();
  });
  test('rejects malformed estimates instead of inventing a reset time', () {
    expect(PurchaseAccessInfo.parse({'mode': 'TEMPORARY_LIMIT', 'serverTime': 'bad'}), isNull);
    expect(PurchaseAccessInfo.parse({'mode': 'TEMPORARY_LIMIT', 'serverTime': '2026-10-25T13:00:00Z', 'retryAt': '2026-10-25T12:00:00Z'}), isNull);
  });
  testWidgets('shows exact local date, UTC offset and countdown using the server clock', (tester) async {
    final info = PurchaseAccessInfo.parse({'mode': 'TEMPORARY_LIMIT', 'serverTime': '2026-10-25T12:00:00Z', 'retryAt': '2026-10-25T13:00:00Z'});
    await tester.pumpWidget(shell(PurchaseAccessNotice(info: info)));
    expect(find.textContaining('Estimated purchase access:'), findsOneWidget);
    expect(find.textContaining('UTC'), findsOneWidget);
    expect(find.textContaining('01:00:00'), findsOneWidget);
    expect(find.textContaining('airtime and internet bundles'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    expect(tester.takeException(), isNull);
  });
  testWidgets('expired countdown invites a check without starting a payment', (tester) async {
    final info = PurchaseAccessInfo.parse({'mode': 'TEMPORARY_LIMIT', 'serverTime': '2026-10-25T12:00:00Z', 'retryAt': '2026-10-25T12:00:00Z'});
    await tester.pumpWidget(shell(PurchaseAccessNotice(info: info)));
    expect(find.textContaining('estimated wait has ended'), findsOneWidget);
    expect(find.byType(ElevatedButton), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('manual restrictions never display a fabricated countdown', (tester) async {
    await tester.pumpWidget(shell(const PurchaseAccessNotice()));
    expect(find.textContaining('Contact support'), findsOneWidget);
    expect(find.textContaining('Time remaining:'), findsNothing);
  });
}
