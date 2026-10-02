import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/checkout_contract.dart';
import 'package:flupflap/recharge_journey.dart';
import 'package:flupflap/parity_strings.dart';
import 'package:ticash/models/mobile_top_up.dart';

const txnId = '12345678-1234-4234-8234-123456789abc';
const quoteId = '12345678-1234-4234-8234-123456789abd';
Map<String, dynamic> status({
  bool live = false,
  String mode = 'STRIPE_SANDBOX',
}) => {
  'enabled': true,
  'environment': live ? 'PRODUCTION' : 'SANDBOX',
  'testMode': !live,
  'productionEnabled': live,
  'approvedForLiveUse': live,
  'liveRechargeEnabled': live,
  'paymentMode': mode,
};
Map<String, dynamic> methods({
  bool live = false,
  String provider = 'STRIPE',
}) => {
  'environment': live ? 'PRODUCTION' : 'SANDBOX',
  'methods': [
    {'type': 'CARD', 'provider': provider, 'enabled': true, 'testMode': !live},
  ],
};
Map<String, dynamic> session({bool live = false}) => {
  'provider': 'STRIPE',
  'environment': live ? 'PRODUCTION' : 'SANDBOX',
  'testMode': !live,
  'transactionId': txnId,
  'checkoutSession': {
    'id': live ? 'cs_live_fixture' : 'cs_test_fixture',
    'url': 'https://checkout.stripe.com/c/pay/cs_test_fixture',
  },
  'amountMinor': 624,
  'currency': 'USD',
  'paymentStatus': 'SESSION_CREATED',
};

class ParityAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  String paymentMode = 'STRIPE_SANDBOX',
      transactionStatus = 'PROCESSING',
      paymentStatus = 'AUTHORIZED';
  bool failPayment = false, promoted = false, pendingHistory = false;
  int quoteCount = 0;
  String responseTransactionId = txnId;
  String? cancelCode, failureCode;
  bool failStatus = false, failHistory = false;
  List<Map<String, dynamic>>? historyRows;
  final transactionById = <String, Map<String, dynamic>>{};
  Future<void>? statusGate;
  final products = <Map<String, dynamic>>[
    {
      'id': 'fixed',
      'operatorId': 9,
      'name': 'Catalog airtime',
      'kind': 'AIRTIME',
      'price': 5,
      'priceCurrency': 'USD',
      'deliveredCurrency': 'HTG',
      'amountType': 'FIXED',
    },
    {
      'id': 'range',
      'operatorId': 9,
      'name': 'Catalog range',
      'kind': 'AIRTIME',
      'price': 5,
      'priceCurrency': 'USD',
      'deliveredCurrency': 'HTG',
      'amountType': 'RANGE',
      'minimumAmount': 4,
      'maximumAmount': 90,
      'amountIncrement': 0.5,
      'amountPrecision': 2,
    },
    {
      'id': 'data',
      'operatorId': 9,
      'name': 'Catalog data',
      'kind': 'DATA',
      'price': 12,
      'priceCurrency': 'USD',
      'deliveredCurrency': 'HTG',
      'amountType': 'FIXED',
      'catalogVersion': 'snapshot-v1',
    },
  ];
  Map<String, dynamic> get transaction => {
    'id': responseTransactionId,
    'countryCode': 'HT',
    'recipientPhone': '+50937000000',
    'operatorName': 'Catalog carrier',
    'productName': 'Catalog airtime',
    'providerAmount': 5,
    'providerCurrency': 'USD',
    'feeUsd': 1.24,
    'totalChargeUsd': 6.24,
    'status': transactionStatus,
    'paymentStatus': paymentStatus,
    if (failureCode != null) 'failureCode': failureCode,
    'testMode': true,
  };
  Map<String, dynamic> quote(Map body) => {
    'id': quoteCount <= 1 ? quoteId : '12345678-1234-4234-8234-123456789abe',
    'countryCode': body['countryCode'] ?? 'HT',
    'recipientPhone': body['phone'] ?? '+50937000000',
    'operatorId': body['operatorId'] ?? 9,
    'operatorName': 'Catalog carrier',
    'productId': body['productId'] ?? 'fixed',
    'productName': 'Catalog airtime',
    'kind': 'AIRTIME',
    'providerAmount': 5,
    'providerCurrency': 'USD',
    'deliveredValue': 650,
    'deliveredCurrency': 'HTG',
    'feeUsd': promoted ? 0.74 : 1.24,
    'totalChargeUsd': promoted ? 5.74 : 6.24,
    'expiresAt': '2099-01-01T00:00:00Z',
  };
  @override
  Future<ResponseBody> fetch(
    RequestOptions o,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    requests.add(o);
    Object data;
    int code = 200;
    final op = {
      'id': 9,
      'countryCode': 'HT',
      'name': 'Catalog carrier',
      'bundle': false,
      'logoUrl': 'https://carrier.example/logo.png',
    };
    if (o.path.endsWith('/status')) {
      data = status(mode: paymentMode);
    } else if (o.path.endsWith('/payment-methods')) {
      data = methods(provider: paymentMode == 'MOCK' ? 'MOCK' : 'STRIPE');
    } else if (o.path.endsWith('/countries')) {
      data = {
        'countries': [
          {'code': 'HT', 'name': 'Haiti'},
          {'code': 'US', 'name': 'United States'},
        ],
      };
    } else if (o.path.endsWith('/recipients')) {
      data = {'recipients': []};
    } else if (o.path.endsWith('/operators/detect')) {
      data = {'operator': op};
    } else if (o.path.endsWith('/operators')) {
      data = {
        'operators': [
          op,
          {...op, 'id': 10},
        ],
      };
    } else if (o.path.endsWith('/products')) {
      data = {'products': products};
    } else if (o.path.contains('/marketing/quotes/')) {
      data = {
        'promotion': promoted
            ? {
                'name': 'Server promotion',
                'originalFeeCents': 124,
                'benefitCents': 50,
                'feeCents': 74,
                'totalCents': 574,
              }
            : null,
      };
    } else if (o.path.endsWith('/quotes') || o.path.endsWith('/repeat')) {
      quoteCount++;
      data = {'quote': quote(o.data is Map ? o.data as Map : {})};
    } else if (o.path.endsWith('/payment-sessions')) {
      if (failPayment) {
        throw DioException(
          requestOptions: o,
          type: DioExceptionType.receiveTimeout,
        );
      }
      data = {...session(), 'transactionId': responseTransactionId};
    } else if (o.path.endsWith('/checkout-resume')) {
      await statusGate;
      data = {'transaction': transaction};
    } else if (o.path.endsWith('/transactions') && o.method == 'GET') {
      if (failHistory) {
        throw DioException(
          requestOptions: o,
          type: DioExceptionType.connectionError,
        );
      }
      data = {
        'transactions': historyRows ?? (pendingHistory ? [transaction] : []),
      };
    } else if (o.path.endsWith('/cancel')) {
      if (cancelCode != null) {
        code = 409;
        data = {'code': cancelCode};
      } else {
        transactionStatus = 'FAILED';
        paymentStatus = 'FAILED';
        failureCode = 'CANCELLED_BY_CUSTOMER';
        historyRows = historyRows
            ?.map((r) => r['id'] == responseTransactionId ? transaction : r)
            .toList();
        data = {'transaction': transaction};
      }
    } else if (o.path.contains('/transactions')) {
      await statusGate;
      if (failStatus) {
        throw DioException(
          requestOptions: o,
          type: DioExceptionType.connectionError,
        );
      }
      data = {
        'transaction': transactionById[o.path.split('/').last] ?? transaction,
      };
    } else if (o.path.endsWith('/visits')) {
      data = {'capability': 'a' * 43};
    } else if (o.path.endsWith('/attribution')) {
      promoted = true;
      data = {'ok': true};
    } else if (o.path.endsWith('/share')) {
      final code = 'b' * 32;
      data = {'code': code, 'url': 'https://www.flupflap.com/join?r=$code'};
    } else if (o.path.endsWith('/share/qr')) {
      data = {
        'dataUrl':
            'data:image/png;base64,${base64Encode([137, 80, 78, 71, 13, 10, 26, 10])}',
      };
    } else if (o.path.endsWith('/signup-started')) {
      data = {'ok': true};
    } else {
      throw StateError('Unexpected test request ${o.method} ${o.path}');
    }
    return ResponseBody.fromString(
      jsonEncode(data),
      code,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

(ParityAdapter, FlupFlapClient, RechargeJourney) fixture({
  bool guest = true,
  DateTime Function()? clock,
}) {
  final a = ParityAdapter();
  final c = FlupFlapClient(
    Dio(BaseOptions(baseUrl: 'https://api.example.test/api'))
      ..httpClientAdapter = a,
  );
  final j = RechargeJourney(
    c,
    guest: () => guest,
    storedBillingCountry: () => 'CA',
    clock: clock,
  );
  addTearDown(j.dispose);
  return (a, c, j);
}

Future<void> reviewed(RechargeJourney j, {String product = 'fixed'}) async {
  await j.initialize();
  j.destination(code: 'HT', number: '+50937000000');
  await j.continueDestination();
  j.selectProduct(j.products.firstWhere((p) => p.id == product));
  if (product == 'range') j.setAmount('6.50');
  await j.review();
  j.setBillingCountry('US');
  j.confirmReview(true);
}

void main() {
  for (final mode in CheckoutMode.values) {
    test('backend $mode gates required', () {
      final live = mode == CheckoutMode.stripeLive;
      final s = status(
        live: live,
        mode: mode == CheckoutMode.mock
            ? 'MOCK'
            : live
            ? 'STRIPE_LIVE'
            : 'STRIPE_SANDBOX',
      );
      expect(
        PaymentMethods.parse(
          methods(
            live: live,
            provider: mode == CheckoutMode.mock ? 'MOCK' : 'STRIPE',
          ),
          MobileTopUpAvailability.fromJson(s),
        ).mode,
        mode,
      );
      for (final flag in [
        'productionEnabled',
        'approvedForLiveUse',
        'liveRechargeEnabled',
      ]) {
        expect(
          () => PaymentMethods.parse(
            methods(live: live),
            MobileTopUpAvailability.fromJson({...s, flag: !live}),
          ),
          throwsFormatException,
        );
      }
    });
  }
  test('live cannot downgrade to mock or missing mode', () {
    expect(
      () => PaymentMethods.parse(
        methods(live: true, provider: 'MOCK'),
        MobileTopUpAvailability.fromJson(
          status(live: true, mode: 'STRIPE_LIVE'),
        ),
      ),
      throwsFormatException,
    );
    expect(
      () => PaymentMethods.parse(
        methods(),
        MobileTopUpAvailability.fromJson(status()..remove('paymentMode')),
      ),
      throwsFormatException,
    );
  });
  test('hosted checkout validates server total and no secrets', () {
    expect(
      HostedSession.parse(
        session(),
        CheckoutMode.stripeSandbox,
        624,
      ).amountMinor,
      624,
    );
    for (final bad in [
      {...session(), 'amountMinor': 625},
      {...session(), 'currency': 'EUR'},
      {...session(), 'provider': 'MOCK'},
      {...session(), 'checkoutResumeToken': 'a' * 43},
      {...session(), 'testMode': false},
      {...session(), 'accessToken': 'secret'},
    ]) {
      expect(
        () => HostedSession.parse(bad, CheckoutMode.stripeSandbox, 624),
        throwsFormatException,
      );
    }
  });
  for (final url in [
    'http://checkout.stripe.com/pay',
    'https://evil.example/pay',
    'https://checkout.stripe.com.evil.example/pay',
    'https://evil@checkout.stripe.com/pay',
    'https://checkout.stripe.com:8443/pay',
    'javascript:alert(1)',
    'https://checkout.stripe.com/pay?access_token=x',
  ]) {
    test(
      'reject checkout URL $url',
      () => expect(HostedSession.safeUrl(url), false),
    );
  }
  test(
    'destination/operator/product/back invalidate only downstream selections',
    () async {
      final (_, _, j) = fixture();
      await reviewed(j);
      expect(j.step, RechargeStep.review);
      expect(j.operator?.logoUrl, 'https://carrier.example/logo.png');
      j.back();
      expect(j.step, RechargeStep.product);
      expect(j.product?.id, 'fixed');
      j.back();
      expect(j.step, RechargeStep.destination);
      j.destination(code: 'HT', number: '+50938000000');
      expect(j.operator, isNull);
      expect(j.quote, isNull);
      expect(j.products, isEmpty);
      await j.continueDestination();
      j.selectProduct(j.products.first);
      await j.review();
      j.back();
      await j.selectOperator(j.operators.last);
      expect(j.quote, isNull);
      expect(j.product, isNull);
      j.destination(code: 'US', number: '+15551234567');
      expect(j.operator, isNull);
      expect(j.billingCountry, 'US');
    },
  );
  test('DATA snapshot sent; no amount fee or provider override', () async {
    final (a, _, j) = fixture();
    await reviewed(j, product: 'data');
    final body =
        a.requests.singleWhere((r) => r.path.endsWith('/quotes')).data as Map;
    expect(body, {
      'countryCode': 'HT',
      'phone': '+50937000000',
      'operatorId': 9,
      'productId': 'data',
      'catalogVersion': 'snapshot-v1',
    });
  });
  test(
    'range validates min max increment precision before requesting quote',
    () async {
      final (a, _, j) = fixture();
      await reviewed(j, product: 'range');
      expect(
        a.requests
            .singleWhere((r) => r.path.endsWith('/quotes'))
            .data['amount'],
        6.5,
      );
      for (final invalid in ['3', '91', '6.25', '6.501', 'NaN']) {
        j.setAmount(invalid);
        await j.review();
        expect(j.quote, isNull);
      }
      expect(a.quoteCount, 1);
    },
  );
  test(
    'guest HT + US session temporary, duplicate pay blocked, same-key retry',
    () async {
      final (a, _, j) = fixture();
      await reviewed(j);
      a.failPayment = true;
      await j.pay();
      expect(j.locked, true);
      expect(j.canBack, false);
      expect(
        () => j.destination(code: 'US', number: '+15551234567'),
        throwsStateError,
      );
      await j.pay();
      a.failPayment = false;
      await j.retryPayment();
      final req = a.requests
          .where((r) => r.path.endsWith('/payment-sessions'))
          .toList();
      expect(req.length, 2);
      expect(
        req.first.headers['Idempotency-Key'],
        req.last.headers['Idempotency-Key'],
      );
      expect(req.last.data, {
        'quoteId': quoteId,
        'returnTarget': 'FLUPFLAP_ANDROID',
        'billingCountry': 'US',
      });
      expect(j.hosted, isNotNull);
      expect(
        a.requests.where(
          (r) =>
              r.method == 'PATCH' ||
              r.path.endsWith('/transactions') && r.method == 'POST',
        ),
        isEmpty,
      );
    },
  );
  test('permanent session never overrides stored billing profile', () async {
    final (a, _, j) = fixture(guest: false);
    await reviewed(j);
    await j.pay();
    expect(j.hosted, isNotNull);
    expect(
      a.requests.singleWhere((r) => r.path.endsWith('/payment-sessions')).data,
      {'quoteId': quoteId, 'returnTarget': 'FLUPFLAP_ANDROID'},
    );
  });
  test('expired quote never sends payment', () async {
    var now = DateTime(2026);
    final (a, _, j) = fixture(clock: () => now);
    await reviewed(j);
    now = DateTime(2100);
    expect(j.canPay, false);
    await j.pay();
    expect(
      a.requests.where((r) => r.path.endsWith('/payment-sessions')),
      isEmpty,
    );
  });
  test(
    'resume read-only and pending cannot unlock; terminal comes only from server',
    () async {
      final (a, _, j) = fixture();
      await j.resume('a' * 43);
      expect(j.locked, true);
      expect(j.result?.status, 'PROCESSING');
      expect(j.hosted, isNull);
      a.transactionStatus = 'DELIVERED';
      a.paymentStatus = 'CAPTURED';
      await j.refresh();
      expect(j.locked, false);
      expect(j.result?.terminal, true);
      expect(
        a.requests.every((r) => r.path.endsWith('/checkout-resume')),
        true,
      );
      expect(a.requests.first.data, {'resumeToken': 'a' * 43});
    },
  );
  test(
    'a new return capability waits for but never reuses an older status response',
    () async {
      final (a, _, j) = fixture();
      final gate = Completer<void>();
      a.statusGate = gate.future;
      final first = j.resume('a' * 43);
      await Future<void>.delayed(Duration.zero);
      final second = j.resume('b' * 43);
      gate.complete();
      await Future.wait([first, second]);
      final calls = a.requests
          .where((r) => r.path.endsWith('/checkout-resume'))
          .toList();
      expect(calls.length, 2);
      expect(calls.last.data, {'resumeToken': 'b' * 43});
      expect(j.locked, true);
      expect(j.hosted, isNull);
    },
  );
  test(
    'cancellation does not target a transaction resolved by an in-flight status read',
    () async {
      final (a, _, j) = fixture();
      a.pendingHistory = true;
      await j.initialize();
      final gate = Completer<void>();
      a.statusGate = gate.future;
      final refresh = j.refresh();
      await Future<void>.delayed(Duration.zero);
      final cancellation = j.cancelPending();
      a.transactionStatus = 'DELIVERED';
      a.paymentStatus = 'CAPTURED';
      gate.complete();
      await Future.wait([refresh, cancellation]);
      expect(a.requests.where((r) => r.path.endsWith('/cancel')), isEmpty);
      expect(j.locked, false);
    },
  );
  test('restart pending history prevents another attempt', () async {
    final (a, _, j) = fixture();
    a.pendingHistory = true;
    await j.initialize();
    expect(j.locked, true);
    expect(j.step, RechargeStep.recovery);
    await j.pay();
    expect(
      a.requests.where((r) => r.path.endsWith('/payment-sessions')),
      isEmpty,
    );
  });
  test(
    'terminal startup history leaves Destination accessible and remains in history',
    () async {
      final (a, _, j) = fixture();
      a.pendingHistory = true;
      a.transactionStatus = 'DELIVERED';
      a.paymentStatus = 'CAPTURED';
      await j.initialize();
      expect(j.step, RechargeStep.destination);
      expect(j.locked, false);
      expect(j.result, isNull);
      expect(j.history.single.terminal, true);
      expect(a.requests.where((r) => r.path.endsWith('/$txnId')), isEmpty);
    },
  );
  test(
    'startup refresh resolves stale pending history before enabling Destination',
    () async {
      final (a, _, j) = fixture();
      a.historyRows = [a.transaction];
      a.transactionStatus = 'FAILED';
      a.paymentStatus = 'FAILED';
      await j.initialize();
      expect(j.step, RechargeStep.destination);
      expect(j.locked, false);
      expect(j.history.single.terminal, true);
      expect(
        a.requests
            .singleWhere((r) => r.path.endsWith('/$txnId'))
            .queryParameters,
        {'refresh': true},
      );
    },
  );
  test('failed authoritative refresh stays in locked recovery', () async {
    final (a, _, j) = fixture();
    a.pendingHistory = true;
    a.failStatus = true;
    await j.initialize();
    expect(j.step, RechargeStep.recovery);
    expect(j.locked, true);
    expect(j.hosted, isNull);
    expect(j.error, 'requestFailed');
  });
  test(
    'safe server cancellation clears the attempt and returns to Destination',
    () async {
      final (a, _, j) = fixture();
      a.pendingHistory = true;
      await j.initialize();
      expect(j.canCancel, true);
      await j.cancelPending();
      expect(j.error, isNull);
      expect(j.locked, false);
      expect(j.initialized, true);
      expect(j.step, RechargeStep.destination);
      expect(j.result, isNull);
      expect(j.notice, 'cancelledStartNew');
      expect(j.history.single.data['failureCode'], 'CANCELLED_BY_CUSTOMER');
      final cancel = a.requests.singleWhere((r) => r.path.endsWith('/cancel'));
      expect(cancel.method, 'POST');
      expect(cancel.path, '/flupflap/mobile-topups/transactions/$txnId/cancel');
      expect(
        a.requests.where((r) => r.path.endsWith('/payment-sessions')),
        isEmpty,
      );
    },
  );
  for (final code in [
    'TOPUP_NOT_CANCELLABLE',
    'TOPUP_CANCELLATION_UNRESOLVED',
  ]) {
    test(
      'unsafe cancellation $code stays locked without another payment',
      () async {
        final (a, _, j) = fixture();
        a.pendingHistory = true;
        a.cancelCode = code;
        await j.initialize();
        await j.cancelPending();
        expect(j.locked, true);
        expect(j.step, RechargeStep.recovery);
        expect(j.error, 'cancellationUnresolved');
        expect(() => j.startAnother(), throwsStateError);
        expect(
          a.requests.where((r) => r.path.endsWith('/payment-sessions')),
          isEmpty,
        );
      },
    );
  }
  test(
    'cancellation cannot unlock when remaining history cannot be verified',
    () async {
      final (a, _, j) = fixture();
      a.pendingHistory = true;
      await j.initialize();
      a.failHistory = true;
      await j.cancelPending();
      expect(j.locked, true);
      expect(j.canPay, false);
      a.failHistory = false;
      await j.refresh();
      expect(j.locked, false);
      expect(j.step, RechargeStep.destination);
    },
  );
  test(
    'cancelling one pending transaction never unlocks a second pending transaction',
    () async {
      final (a, _, j) = fixture();
      const otherId = '12345678-1234-4234-8234-123456789abf';
      final second = {...a.transaction, 'id': otherId};
      a.historyRows = [a.transaction, second];
      a.transactionById[otherId] = second;
      await j.initialize();
      await j.cancelPending();
      expect(j.locked, true);
      expect(j.result?.id, otherId);
      expect(j.step, RechargeStep.recovery);
      expect(j.history.first.terminal, true);
      expect(j.history.last.terminal, false);
      expect(
        a.requests.where((r) => r.path.endsWith('/payment-sessions')),
        isEmpty,
      );
    },
  );
  test(
    'normal recharge entry clears terminal result, retains active checkout lock',
    () async {
      final (a, _, j) = fixture();
      await reviewed(j);
      await j.pay();
      j.enterRecharge();
      expect(j.locked, true);
      expect(j.hosted, isNotNull);
      a.transactionStatus = 'DELIVERED';
      a.paymentStatus = 'CAPTURED';
      await j.refresh();
      expect(j.result?.terminal, true);
      j.enterRecharge();
      expect(j.step, RechargeStep.destination);
      expect(j.result, isNull);
      expect(j.quote, isNull);
    },
  );
  for (final pair in [
    ('PROCESSING', 'AUTHORIZED', false),
    ('DELIVERED', 'CAPTURED', true),
    ('FAILED', 'FAILED', true),
    ('FAILED', 'REFUND_PENDING', false),
    ('REFUNDED', 'REFUNDED', true),
    ('FAILED', 'VOID_PENDING', false),
    ('FAILED', 'VOIDED', true),
    ('UNKNOWN', 'UNKNOWN', false),
  ]) {
    test('receipt state ${pair.$1}/${pair.$2}', () {
      final a = ParityAdapter()
        ..transactionStatus = pair.$1
        ..paymentStatus = pair.$2;
      expect(RechargeResult(a.transaction).terminal, pair.$3);
    });
  }
  test(
    'promotion normalized, attribution memory only, new quote server adjusted',
    () async {
      final (a, c, j) = fixture();
      await reviewed(j);
      await j.applyPromotion(' welcome ');
      expect(j.quote, isNull);
      await j.review();
      expect(j.quote?.totalChargeUsd, 5.74);
      expect(j.promotion?['benefitCents'], 50);
      expect(a.requests.singleWhere((r) => r.path.endsWith('/visits')).data, {
        'promo': 'WELCOME',
      });
      expect(a.quoteCount, 2);
      c.clearCapabilities();
      final count = a.requests.length;
      await c.claim();
      expect(a.requests.length, count);
    },
  );
  test(
    'referral guest denied without network and QR bound to safe firstparty URL',
    () async {
      final (a, c, _) = fixture();
      await expectLater(c.share(guest: true), throwsStateError);
      expect(a.requests, isEmpty);
      final code = 'b' * 32,
          png =
              'data:image/png;base64,${base64Encode([137, 80, 78, 71, 13, 10, 26, 10])}';
      expect(
        ReferralShare.parse(
          {'code': code, 'url': 'https://www.flupflap.com/join?r=$code'},
          {'dataUrl': png},
        ).code,
        code,
      );
      expect(
        () => ReferralShare.parse(
          {'code': code, 'url': 'https://evil.example/?r=$code'},
          {'dataUrl': png},
        ),
        throwsFormatException,
      );
    },
  );
  test('repeat uses fresh quote without purchase', () async {
    final (a, _, j) = fixture();
    await j.initialize();
    a.transactionStatus = 'DELIVERED';
    a.paymentStatus = 'CAPTURED';
    await j.repeat(RechargeResult(a.transaction));
    expect(j.step, RechargeStep.review);
    expect(j.reviewed, false);
    expect(a.quoteCount, 1);
    j.back();
    expect(j.step, RechargeStep.destination);
    expect(
      a.requests.where((r) => r.path.endsWith('/payment-sessions')),
      isEmpty,
    );
  });
  test('safe localized error codes; never provider raw error', () {
    final (_, _, j) = fixture();
    for (final pair in [
      ('INSUFFICIENT_FUNDS', 'insufficientFunds'),
      ('PAYMENT_DECLINED', 'paymentDeclined'),
      ('GUEST_SCOPE_RESTRICTED', 'accountRequired'),
    ]) {
      final options = RequestOptions();
      expect(
        j.safeError(
          DioException(
            requestOptions: options,
            response: Response(
              requestOptions: options,
              data: {'code': pair.$1, 'secret': 'never show'},
            ),
          ),
        ),
        pair.$2,
      );
    }
    expect(j.safeError(Exception('secret')), 'requestFailed');
  });
  test('all five catalogs contain every English UI key', () {
    for (final code in ['en', 'ht', 'fr', 'es', 'pt']) {
      expect(
        flupFlapStrings[code]!.keys.toSet(),
        flupFlapStrings['en']!.keys.toSet(),
      );
      expect(flupFlapStrings[code]!.values.every((v) => v.isNotEmpty), true);
    }
  });
  test(
    'registered share and QR use existing isolated backend routes',
    () async {
      final (a, c, _) = fixture(guest: false);
      final share = await c.share(guest: false);
      expect(share.code, 'b' * 32);
      expect(a.requests.map((r) => r.path).toList(), [
        '/flupflap/marketing/share',
        '/flupflap/marketing/share/qr',
      ]);
      expect(share.url, 'https://www.flupflap.com/join?r=${'b' * 32}');
    },
  );
  test(
    'signup attribution waits for pending visit and cleared capability cannot return',
    () async {
      final (a, c, _) = fixture();
      final visit = c.visit(promo: 'welcome');
      await c.signupStarted();
      await visit;
      expect(a.requests.last.path, '/flupflap/marketing/signup-started');
      expect(a.requests.last.data, {'capability': 'a' * 43});
      final pending = c.visit(promo: 'welcome');
      c.clearCapabilities();
      await pending;
      final count = a.requests.length;
      await c.claim();
      expect(a.requests.length, count);
    },
  );
  test(
    'repeat after completed checkout binds a new session, never reuses prior transaction',
    () async {
      final (a, _, j) = fixture();
      await reviewed(j);
      await j.pay();
      a.transactionStatus = 'DELIVERED';
      a.paymentStatus = 'CAPTURED';
      await j.refresh();
      final prior = j.result!, oldQuote = j.quote!.id;
      await j.repeat(prior);
      expect(j.quote!.id, isNot(oldQuote));
      expect(j.hosted, isNull);
      expect(j.reviewed, false);
      a.responseTransactionId = '12345678-1234-4234-8234-123456789aff';
      j.confirmReview(true);
      await j.pay();
      expect(j.error, isNull);
      expect(j.hosted?.transactionId, a.responseTransactionId);
      final requests = a.requests
          .where((r) => r.path.endsWith('/payment-sessions'))
          .toList();
      expect(requests.length, 2);
      expect(
        requests.first.headers['Idempotency-Key'],
        isNot(requests.last.headers['Idempotency-Key']),
      );
    },
  );
}
