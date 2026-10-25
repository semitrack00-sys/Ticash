import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/recharge_journey.dart';

import 'checkout_parity_test.dart' show fixture, reviewed, quoteId, txnId;

void main() {
  test('a status lookup finishing after a confirmed rejection cannot resurrect that attempt', () async {
    final (a, _, j) = fixture();
    await reviewed(j);
    final paymentGate = Completer<void>(), lookupGate = Completer<void>();
    a.paymentGate = paymentGate.future;
    a.statusGate = lookupGate.future;
    a.paymentErrorCode = 'EMAIL_VERIFICATION_REQUIRED';
    a.attemptFound = true;
    a.transactionStatus = 'DELIVERED';
    a.paymentStatus = 'CAPTURED';
    final payment = j.pay();
    await Future<void>.delayed(Duration.zero);
    final lookup = j.refresh();
    await Future<void>.delayed(Duration.zero);
    paymentGate.complete();
    await payment;
    expect(j.locked, false);
    lookupGate.complete();
    await lookup;
    expect(j.locked, false);
    expect(j.result, isNull);
    expect(j.error, 'emailVerificationRequired');
    expect(j.step, RechargeStep.review);
  });
  for (final code in [
    'EMAIL_VERIFICATION_REQUIRED',
    'RECHARGE_RESTRICTED',
    'DEVICE_RESTRICTED_LINK',
    'DEVICE_ACCOUNT_LIMIT',
    'PAYMENT_ATTEMPT_LIMIT',
    'PAYMENT_CARD_LIMIT',
  ]) {
    test(
      'confirmed initial $code rejection does not create a false pending lock',
      () async {
        final (a, _, j) = fixture(guest: false);
        await reviewed(j);
        a.paymentErrorCode = code;
        await j.pay();
        expect(j.locked, false);
        expect(j.step, RechargeStep.review);
        expect(j.reviewed, false);
        expect(j.error, isNot('requestFailed'));
        await j.retryPayment();
        expect(
          a.requests.where((r) => r.path.endsWith('/payment-sessions')).length,
          1,
        );
      },
    );
  }
  test(
    'a later security rejection never clears an earlier uncertain attempt',
    () async {
      final (a, _, j) = fixture();
      await reviewed(j);
      a.failPayment = true;
      await j.pay();
      a.failPayment = false;
      a.paymentErrorCode = 'EMAIL_VERIFICATION_REQUIRED';
      await j.retryPayment();
      expect(j.locked, true);
      expect(j.error, 'emailVerificationRequired');
      await j.refresh();
      expect(j.locked, true);
      expect(j.error, 'paymentOutcomeUnknown');
      final calls = a.requests
          .where((r) => r.path.endsWith('/payment-sessions'))
          .toList();
      expect(
        calls[0].headers['Idempotency-Key'],
        calls[1].headers['Idempotency-Key'],
      );
      expect(a.requests.last.data, {
        'idempotencyKey': calls[0].headers['Idempotency-Key'],
        'quoteId': quoteId,
      });
    },
  );
  for (final terminal in [false, true]) {
    test(
      'Check status recovers a missing order ID, terminal=$terminal, without another payment',
      () async {
        final (a, _, j) = fixture();
        await reviewed(j);
        a.failPayment = true;
        await j.pay();
        expect(j.error, 'paymentOutcomeUnknown');
        a.attemptFound = true;
        a.transactionStatus = terminal ? 'DELIVERED' : 'PENDING';
        a.paymentStatus = terminal ? 'CAPTURED' : 'SESSION_CREATED';
        a.attemptResponse = {
          'transaction': {
            ...a.transaction,
            'paymentSessionId': 'cs_test_fixture',
          },
        };
        await j.refresh();
        expect(j.result?.id, txnId);
        expect(j.locked, !terminal);
        expect(j.canCancel, !terminal);
        expect(j.hosted != null, !terminal);
        expect(
          a.requests.where((r) => r.path.endsWith('/payment-sessions')).length,
          1,
        );
        expect(
          a.requests
              .where((r) => r.path.endsWith('/payment-attempt-status'))
              .length,
          1,
        );
      },
    );
  }
  test(
    'an absent lookup stays locked and retries retain the original key',
    () async {
      final (a, _, j) = fixture();
      await reviewed(j);
      a.failPayment = true;
      await j.pay();
      await j.refresh();
      expect(j.locked, true);
      expect(j.error, 'paymentOutcomeUnknown');
      expect(j.canCancel, false);
      a.failPayment = false;
      await j.retryPayment();
      final calls = a.requests
          .where((r) => r.path.endsWith('/payment-sessions'))
          .toList();
      expect(calls.length, 2);
      expect(
        calls[0].headers['Idempotency-Key'],
        calls[1].headers['Idempotency-Key'],
      );
    },
  );
  test(
    'an attempt status with the wrong quote never unlocks or exposes checkout',
    () async {
      final (a, _, j) = fixture();
      await reviewed(j);
      a.failPayment = true;
      await j.pay();
      a.attemptResponse = {
        'transaction': {
          ...a.transaction,
          'quoteId': '12345678-1234-4234-8234-123456789abe',
          'status': 'DELIVERED',
          'paymentStatus': 'CAPTURED',
        },
      };
      await j.refresh();
      expect(j.locked, true);
      expect(j.result, isNull);
      expect(j.hosted, isNull);
    },
  );
}
