import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/checkout_contract.dart';
import 'package:flupflap/recharge_journey.dart';
import 'package:flupflap/recharge_screen.dart';
import 'checkout_parity_test.dart' show fixture, reviewed;
import 'parity_widget_test.dart' show shell, press;

final back = find.byKey(const ValueKey('recharge-back'));

Future<void> openRecharge(
  WidgetTester t,
  RechargeJourney journey, {
  bool history = false,
}) async {
  await t.pumpWidget(
    shell(
      Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) =>
                    RechargeJourneyScreen(journey: journey, history: history),
              ),
            ),
            child: const Text('Open recharge'),
          ),
        ),
      ),
    ),
  );
  await press(t, find.text('Open recharge'));
}

void expectNoProgress() {
  expect(find.byType(Chip), findsNothing);
  expect(find.byType(CircleAvatar), findsNothing);
}

Future<void> goBack(WidgetTester t, bool system) async {
  if (system) {
    await t.binding.handlePopRoute();
    await t.pumpAndSettle();
  } else {
    await press(t, back);
  }
}

void main() {
  for (final system in [false, true]) {
    final control = system ? 'Android system Back' : 'app bar Back';
    for (final repeat in [false, true]) {
      testWidgets(
        '$control follows Review -> Product -> Destination${repeat ? ' for repeat' : ''}',
        (t) async {
          final (adapter, _, j) = fixture();
          if (repeat) {
            await t.runAsync(j.initialize);
            adapter.transactionStatus = 'DELIVERED';
            adapter.paymentStatus = 'CAPTURED';
            await t.runAsync(
              () => j.repeat(RechargeResult(adapter.transaction)),
            );
          } else {
            await t.runAsync(() => reviewed(j));
          }
          await openRecharge(t, j);
          expect(j.step, RechargeStep.review);
          expect(find.widgetWithText(AppBar, 'Recharge'), findsOneWidget);
          expect(t.widget<IconButton>(back).onPressed, isNotNull);
          expectNoProgress();
          await goBack(t, system);
          expect(j.step, RechargeStep.product);
          expect(j.reviewed, isFalse);
          expect(j.products, isNotEmpty);
          expect(t.widget<IconButton>(back).onPressed, isNotNull);
          expectNoProgress();
          await goBack(t, system);
          expect(j.step, RechargeStep.destination);
          expect(find.text('Destination'), findsOneWidget);
          expect(back, findsNothing);
          expect(find.byType(BackButton), findsNothing);
          expect(find.text('Back'), findsNothing);
          expectNoProgress();
          expect(
            adapter.requests.where((r) => r.path.endsWith('/payment-sessions')),
            isEmpty,
          );
          // At the first step system Back may leave the route; there is no
          // previous recharge step or unexpected AppBar-inferred route arrow.
          await t.binding.handlePopRoute();
          await t.pumpAndSettle();
          expect(find.text('Open recharge'), findsOneWidget);
          expect(j.step, RechargeStep.destination);
          await t.pumpWidget(const SizedBox());
        },
      );
    }

    for (final status in ['DELIVERED', 'FAILED']) {
      testWidgets('$control returns terminal $status result to Destination', (
        t,
      ) async {
        final (adapter, _, j) = fixture();
        await t.runAsync(() => reviewed(j));
        await t.runAsync(j.pay);
        await openRecharge(t, j);
        adapter.transactionStatus = status;
        adapter.paymentStatus = status == 'DELIVERED' ? 'CAPTURED' : 'FAILED';
        await t.runAsync(j.refresh);
        await t.pumpAndSettle();
        final history = List.of(j.history);
        final requestCount = adapter.requests.length;
        expect(j.step, RechargeStep.result);
        expect(t.widget<IconButton>(back).onPressed, isNotNull);
        expectNoProgress();
        await goBack(t, system);
        expect(j.step, RechargeStep.destination);
        expect(j.result, isNull);
        expect(j.phone, isEmpty);
        expect(j.locked, isFalse);
        expect(j.history, orderedEquals(history));
        expect(adapter.requests.length, requestCount);
        expect(back, findsNothing);
        expectNoProgress();
        await t.pumpWidget(const SizedBox());
      });
    }

    testWidgets(
      '$control leaves History without rewinding the active recharge',
      (t) async {
        final (_, _, j) = fixture();
        await t.runAsync(() => reviewed(j));
        await openRecharge(t, j, history: true);
        expect(find.widgetWithText(AppBar, 'History'), findsOneWidget);
        expect(back, findsNothing);
        expectNoProgress();
        if (system) {
          await t.binding.handlePopRoute();
          await t.pumpAndSettle();
        } else {
          await press(t, find.byType(BackButton));
        }
        expect(find.text('Open recharge'), findsOneWidget);
        expect(j.step, RechargeStep.review);
        expect(j.reviewed, isTrue);
        await t.pumpWidget(const SizedBox());
      },
    );
  }

  for (final historical in [false, true]) {
    testWidgets(
      '${historical ? 'Recovered' : 'New'} genuine pending payment blocks both Back controls',
      (t) async {
        final (adapter, _, j) = fixture(autoDispose: false);
        if (historical) {
          adapter.pendingHistory = true;
          adapter.transactionStatus = 'PENDING';
          adapter.paymentStatus = 'SESSION_CREATED';
          await t.runAsync(j.initialize);
        } else {
          await t.runAsync(() => reviewed(j));
          await t.runAsync(j.pay);
        }
        await openRecharge(t, j);
        final before = j.step;
        final requestCount = adapter.requests.length;
        expect(j.locked, isTrue);
        expect(t.widget<IconButton>(back).onPressed, isNull);
        expectNoProgress();
        await press(t, back);
        await goBack(t, true);
        expect(j.step, before);
        expect(j.locked, isTrue);
        expect(find.text('Pending payment'), findsOneWidget);
        expect(find.text('Open recharge'), findsNothing);
        expect(adapter.requests.length, requestCount);
        await t.pumpWidget(const SizedBox());
        // The session owns the recovery poller, not the unmounted screen.
        j.dispose();
      },
    );
  }
}
