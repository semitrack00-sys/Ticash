import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/recharge_journey.dart';
import 'checkout_parity_test.dart' show fixture, reviewed;

void main() {
  test('late delivery automatically updates after the old 24-check limit', () {
    fakeAsync((time) {
      final (adapter, _, journey) = fixture(autoDispose: false);
      journey.resume('a' * 43);
      time.elapse(Duration.zero);
      expect(journey.result?.status, 'PROCESSING');
      for (var i = 0; i < 24; i++) {
        time.elapse(const Duration(seconds: 5));
      }
      expect(adapter.requests.length, 25);
      expect(journey.locked, isTrue);
      adapter.transactionStatus = 'DELIVERED';
      adapter.paymentStatus = 'CAPTURED';
      time.elapse(const Duration(seconds: 14));
      expect(journey.result?.status, 'PROCESSING');
      time.elapse(const Duration(seconds: 1));
      expect(journey.result?.status, 'DELIVERED');
      expect(journey.step, RechargeStep.result);
      expect(journey.locked, isFalse);
      final calls = adapter.requests.length;
      time.elapse(const Duration(minutes: 5));
      expect(adapter.requests.length, calls);
      expect(adapter.requests.every((r) => r.path.endsWith('/checkout-resume')), isTrue);
      journey.dispose();
    });
  });

  test('background checks pause and foreground immediately reads delivery', () {
    fakeAsync((time) {
      final (adapter, _, journey) = fixture(autoDispose: false);
      journey.resume('a' * 43);
      time.elapse(Duration.zero);
      journey.setStatusPollingActive(false);
      final calls = adapter.requests.length;
      time.elapse(const Duration(minutes: 5));
      expect(adapter.requests.length, calls);
      adapter.transactionStatus = 'DELIVERED';
      adapter.paymentStatus = 'CAPTURED';
      journey.setStatusPollingActive(true);
      time.elapse(Duration.zero);
      expect(journey.result?.status, 'DELIVERED');
      expect(adapter.requests.length, calls + 1);
      journey.dispose();
    });
  });

  test('authenticated checkout retries status errors without resending payment', () {
    fakeAsync((time) {
      final (adapter, _, journey) = fixture(guest: false, autoDispose: false);
      reviewed(journey).then((_) => journey.pay());
      time.elapse(Duration.zero);
      expect(journey.hosted, isNotNull);
      adapter.failStatus = true;
      time.elapse(const Duration(seconds: 5));
      expect(journey.error, isNotNull);
      expect(journey.locked, isTrue);
      adapter.failStatus = false;
      adapter.transactionStatus = 'DELIVERED';
      adapter.paymentStatus = 'CAPTURED';
      time.elapse(const Duration(seconds: 5));
      expect(journey.result?.status, 'DELIVERED');
      expect(journey.error, isNull);
      expect(adapter.requests.where((r) => r.path.endsWith('/payment-sessions')).length, 1);
      expect(adapter.requests.where((r) => r.path.contains('/transactions/') && r.method != 'GET'), isEmpty);
      journey.dispose();
    });
  });

  test('disposal cancels automatic reads', () {
    fakeAsync((time) {
      final (adapter, _, journey) = fixture(autoDispose: false);
      journey.resume('a' * 43);
      time.elapse(Duration.zero);
      journey.dispose();
      final calls = adapter.requests.length;
      time.elapse(const Duration(minutes: 5));
      expect(adapter.requests.length, calls);
    });
  });
}
