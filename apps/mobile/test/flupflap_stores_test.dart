import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/widgets/flupflap_stores_panel.dart';

void main() {
  for (final width in [390.0, 1200.0]) {
    testWidgets(
      'store admin at $width limits funding actions to authorized staff',
      (tester) async {
        tester.view.physicalSize = Size(width, 1100);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final calls = <RequestOptions>[];
        final dio = Dio()
          ..interceptors.add(
            InterceptorsWrapper(
              onRequest: (r, h) {
                calls.add(r);
                h.resolve(
                  Response(
                    requestOptions: r,
                    data: {
                      'stores': [
                        {
                          'id': 'store-fixture',
                          'name': 'Fixture Market',
                          'contactName': 'Fixture Owner',
                          'phone': '+17755550123',
                          'address': '123 Fixture Street, Reno',
                          'country': 'US',
                          'status': 'PENDING',
                          'balanceCents': 0,
                          'commissionBps': 2000,
                        },
                      ],
                      'total': 1,
                      'funding': [
                        {
                          'id': 'deposit-fixture',
                          'amountCents': 10000,
                          'reference': 'bank-fixture-reference',
                          'createdAt': '2026-10-21',
                          'store': {'name': 'Fixture Market'},
                        },
                      ],
                      'enabledCountries': ['US'],
                      'testMode': true,
                    },
                  ),
                );
              },
            ),
          );
        Future<void> show(bool authorized) => tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: FlupFlapStoresPanel(
                  key: ValueKey(authorized),
                  dio: dio,
                  canManage: authorized,
                  canFund: authorized,
                ),
              ),
            ),
          ),
        );
        await show(false);
        await tester.pumpAndSettle();
        expect(find.text('Verify deposit'), findsNothing);
        expect(find.text('Approve / edit commission'), findsNothing);
        expect(tester.takeException(), isNull);
        await show(true);
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Verify deposit'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Verify deposit'));
        await tester.pumpAndSettle();
        final credit = find.widgetWithText(FilledButton, 'Credit balance');
        expect(tester.widget<FilledButton>(credit).onPressed, isNull);
        await tester.tap(find.byType(CheckboxListTile));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextField, 'Verification / rejection reason'),
          'Bank deposit verified',
        );
        await tester.tap(credit);
        await tester.pumpAndSettle();
        final submitted = calls.where((r) => r.method == 'POST').single;
        expect(
          submitted.path,
          '/admin/flupflap/stores/funding/deposit-fixture/review',
        );
        expect(submitted.data, {
          'approve': true,
          'fundsReceived': true,
          'reason': 'Bank deposit verified',
        });
        expect(tester.takeException(), isNull);
      },
    );
  }
}
