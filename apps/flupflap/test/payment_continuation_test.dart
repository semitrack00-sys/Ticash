import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/native_actions.dart';
import 'package:flupflap/recharge_screen.dart';

import 'checkout_parity_test.dart' show fixture, txnId;
import 'parity_widget_test.dart' show shell;

void main() {
  test(
    'continue payment reuses the existing unpaid session without a POST',
    () async {
      final (adapter, _, journey) = fixture();
      adapter.pendingHistory = true;
      adapter.transactionStatus = 'PENDING';
      adapter.paymentStatus = 'SESSION_CREATED';
      await journey.initialize();
      final sessionId = journey.hosted!.id;
      adapter.requests.clear();

      final url = await journey.checkoutForContinuation();

      expect(url?.host, 'checkout.stripe.com');
      expect(journey.hosted!.id, sessionId);
      expect(journey.hosted!.transactionId, txnId);
      expect(adapter.requests, isNotEmpty);
      expect(
        adapter.requests.every((request) => request.method == 'GET'),
        isTrue,
      );
    },
  );

  for (final state in [
    ('DELIVERED', 'CAPTURED'),
    ('PROCESSING', 'AUTHORIZED'),
  ]) {
    test('stale checkout cannot reopen after ${state.$2}', () async {
      final (adapter, _, journey) = fixture();
      adapter.pendingHistory = true;
      adapter.transactionStatus = 'PENDING';
      adapter.paymentStatus = 'SESSION_CREATED';
      await journey.initialize();
      adapter.transactionStatus = state.$1;
      adapter.paymentStatus = state.$2;
      adapter.requests.clear();

      expect(await journey.checkoutForContinuation(), isNull);
      expect(journey.canContinueCheckout, isFalse);
      expect(
        adapter.requests.every((request) => request.method == 'GET'),
        isTrue,
      );
    });
  }

  test(
    'failed status check keeps order locked and does not reopen checkout',
    () async {
      final (adapter, _, journey) = fixture();
      adapter.pendingHistory = true;
      adapter.transactionStatus = 'PENDING';
      adapter.paymentStatus = 'SESSION_CREATED';
      await journey.initialize();
      adapter.failStatus = true;
      adapter.requests.clear();

      expect(await journey.checkoutForContinuation(), isNull);
      expect(journey.locked, isTrue);
      expect(
        adapter.requests.every((request) => request.method == 'GET'),
        isTrue,
      );
    },
  );

  testWidgets(
    'continue button explains bank verification and prevents double launch',
    (tester) async {
      final (adapter, _, journey) = fixture();
      adapter.pendingHistory = true;
      adapter.transactionStatus = 'PENDING';
      adapter.paymentStatus = 'SESSION_CREATED';
      await tester.runAsync(journey.initialize);
      journey.setStatusPollingActive(false);
      final calls = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        NativeActions.channel,
        (call) async {
          calls.add(call);
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          NativeActions.channel,
          null,
        ),
      );
      await tester.pumpWidget(
        shell(RechargeJourneyScreen(journey: journey, returnOnly: true)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Continue payment'), findsOneWidget);
      expect(
        find.textContaining('Your bank may ask for a code'),
        findsOneWidget,
      );
      expect(
        find.textContaining('We check this order automatically'),
        findsOneWidget,
      );
      final gate = Completer<void>();
      adapter.statusGate = gate.future;
      adapter.requests.clear();
      final action = find.widgetWithText(FilledButton, 'Continue payment');
      await tester.ensureVisible(action);
      await tester.tap(action);
      await tester.pump();
      final opening = find.widgetWithText(FilledButton, 'Opening payment…');
      expect(tester.widget<FilledButton>(opening).onPressed, isNull);
      await tester.tap(opening);
      gate.complete();
      await tester.pumpAndSettle();
      expect(calls.where((call) => call.method == 'checkout'), hasLength(1));
      expect(
        adapter.requests.every((request) => request.method == 'GET'),
        isTrue,
      );

      adapter.transactionStatus = 'DELIVERED';
      adapter.paymentStatus = 'CAPTURED';
      await tester.runAsync(() async {
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await journey.refresh();
      });
      await tester.pumpAndSettle();
      expect(journey.history.single.status, 'DELIVERED');
      expect(journey.locked, isFalse);
      expect(find.text('Continue payment'), findsNothing);
      expect(
        adapter.requests.every((request) => request.method == 'GET'),
        isTrue,
      );
      await tester.pumpWidget(const SizedBox());
    },
  );
}
