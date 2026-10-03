import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'package:ticash/services/mobile_top_up_service.dart';

final _uuid = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final resumeTokenPattern = RegExp(r'^[A-Za-z0-9_-]{43,512}$');
Map<String, dynamic> object(Object? value) {
  if (value is! Map) throw const FormatException('Invalid response');
  return Map<String, dynamic>.from(value);
}

int moneyCents(num value) {
  if (!value.isFinite ||
      value < 0 ||
      (value * 100 - (value * 100).round()).abs() > 0.000001) {
    throw const FormatException('Invalid money');
  }
  return (value * 100).round();
}

String newAttemptKey() {
  final random = Random.secure();
  return List.generate(
    24,
    (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
}

enum CheckoutMode { stripeLive, stripeSandbox, mock }

class PaymentMethods {
  PaymentMethods._(this.mode);
  final CheckoutMode mode;
  factory PaymentMethods.parse(
    Map<String, dynamic> data,
    MobileTopUpAvailability status,
  ) {
    final methods = data['methods'];
    if (!status.enabled || methods is! List) {
      throw const FormatException('Payments unavailable');
    }
    final cards = methods
        .whereType<Map>()
        .where((m) => m['type'] == 'CARD')
        .toList();
    if (cards.length != 1 || cards.single['enabled'] != true) {
      throw const FormatException('Payments unavailable');
    }
    final card = cards.single;
    final sandbox =
        status.environment == 'SANDBOX' &&
        status.testMode &&
        !status.productionEnabled &&
        !status.approvedForLiveUse &&
        !status.liveRechargeEnabled;
    if (data['environment'] != status.environment ||
        card['testMode'] != status.testMode) {
      throw const FormatException('Payment environment mismatch');
    }
    if (status.isGenuinelyLive &&
        status.paymentMode == 'STRIPE_LIVE' &&
        card['provider'] == 'STRIPE') {
      return PaymentMethods._(CheckoutMode.stripeLive);
    }
    if (sandbox &&
        status.paymentMode == 'STRIPE_SANDBOX' &&
        card['provider'] == 'STRIPE') {
      return PaymentMethods._(CheckoutMode.stripeSandbox);
    }
    if (sandbox && status.paymentMode == 'MOCK' && card['provider'] == 'MOCK') {
      return PaymentMethods._(CheckoutMode.mock);
    }
    throw const FormatException('Payment environment mismatch');
  }
}

class HostedSession {
  HostedSession._(
    this.transactionId,
    this.id,
    this.url,
    this.mode,
    this.amountMinor,
  );
  final String transactionId, id;
  final Uri url;
  final CheckoutMode mode;
  final int amountMinor;
  static bool safeUrl(String value) {
    final uri = Uri.tryParse(value);
    return uri != null &&
        uri.scheme == 'https' &&
        uri.host == 'checkout.stripe.com' &&
        (!uri.hasPort || uri.port == 443) &&
        uri.userInfo.isEmpty &&
        uri.path.length > 1 &&
        !RegExp(r'[\s\\\x00-\x1f]').hasMatch(value) &&
        !uri.queryParameters.keys.any(
          (k) => RegExp(
            r'token|secret|transaction|order',
            caseSensitive: false,
          ).hasMatch(k),
        );
  }

  factory HostedSession.parse(
    Map<String, dynamic> data,
    CheckoutMode expected,
    int reviewedTotal,
  ) {
    final checkout = object(data['checkoutSession']);
    final live = expected == CheckoutMode.stripeLive;
    final id = checkout['id'];
    final url = checkout['url'];
    final txn = data['transactionId'];
    if (expected == CheckoutMode.mock ||
        data['provider'] != 'STRIPE' ||
        data['environment'] != (live ? 'PRODUCTION' : 'SANDBOX') ||
        data['testMode'] != !live ||
        txn is! String ||
        !_uuid.hasMatch(txn) ||
        id is! String ||
        !RegExp(
          live ? r'^cs_live_[A-Za-z0-9_]+$' : r'^cs_test_[A-Za-z0-9_]+$',
        ).hasMatch(id) ||
        url is! String ||
        !safeUrl(url) ||
        data['amountMinor'] is! int ||
        data['amountMinor'] != reviewedTotal ||
        reviewedTotal <= 0 ||
        data['currency'] != 'USD' ||
        ![
          'SESSION_CREATED',
          'AWAITING_PAYMENT',
        ].contains(data['paymentStatus']) ||
        _sensitive(data)) {
      throw const FormatException('Invalid hosted checkout');
    }
    return HostedSession._(
      txn,
      id,
      Uri.parse(url),
      expected,
      data['amountMinor'] as int,
    );
  }
  static bool _sensitive(Object? value) {
    if (value is Map) {
      return value.entries.any(
        (e) =>
            RegExp(
              r'^(client_?secret|secret_?key|webhook_?secret|access_?token|refresh_?token|checkoutResumeToken)$',
              caseSensitive: false,
            ).hasMatch(e.key.toString()) ||
            _sensitive(e.value),
      );
    }
    if (value is List) return value.any(_sensitive);
    return false;
  }
}

/// Handles both the public resume DTO and authenticated history records.
/// Unknown states stay unresolved. No URL or client callback supplies a state.
class RechargeResult {
  RechargeResult(this.data) {
    if (data['status'] is! String ||
        data['paymentStatus'] is! String ||
        data['testMode'] is! bool ||
        data['totalChargeUsd'] is! num ||
        data['feeUsd'] is! num ||
        data['providerAmount'] is! num) {
      throw const FormatException('Invalid transaction');
    }
    for (final key in ['totalChargeUsd', 'feeUsd', 'providerAmount']) {
      moneyCents(data[key] as num);
    }
  }
  final Map<String, dynamic> data;
  String get status => data['status'] as String;
  String get paymentStatus => data['paymentStatus'] as String;
  // Only a refreshed authenticated record is a candidate. The server repeats
  // this check and atomically competes with payment creation before cancelling.
  bool get abandonedReservation =>
      status == 'PENDING' &&
      paymentStatus == 'PENDING' &&
      [
        'paymentSessionId',
        'paymentProviderTransactionId',
        'paymentStartedAt',
        'paymentAuthorizationId',
        'providerTransactionId',
        'fulfillmentStartedAt',
        'paymentRecoveryCode',
      ].every((key) => data[key] == null);
  bool get terminal =>
      (status == 'DELIVERED' && paymentStatus == 'CAPTURED') ||
      (['FAILED', 'REFUNDED'].contains(status) &&
          ['FAILED', 'REFUNDED', 'VOIDED'].contains(paymentStatus));
  String get displayState =>
      [
        'REFUND_PENDING',
        'REFUNDED',
        'VOID_PENDING',
        'VOIDED',
      ].contains(paymentStatus)
      ? paymentStatus
      : status;
  String? get id => data['id'] is String ? data['id'] as String : null;
}

class RecurringRechargeSchedule {
  RecurringRechargeSchedule(this.data) {
    final interval = data['intervalDays'];
    final status = data['status'];
    final next = data['nextRunAt'];
    if (data['id'] is! String ||
        !_uuid.hasMatch(data['id'] as String) ||
        interval is! int ||
        ![7, 15, 30].contains(interval) ||
        !['ACTIVE', 'PAUSED', 'CANCELLED'].contains(status) ||
        next is! String ||
        DateTime.tryParse(next) == null ||
        data['maxTotalUsd'] is! num) {
      throw const FormatException('Invalid recurring recharge');
    }
    moneyCents(data['maxTotalUsd'] as num);
  }
  final Map<String, dynamic> data;
  String get id => data['id'] as String;
  int get intervalDays => data['intervalDays'] as int;
  String get status => data['status'] as String;
  DateTime get nextRunAt => DateTime.parse(data['nextRunAt'] as String);
  num get maxTotalUsd => data['maxTotalUsd'] as num;
  String? get failureCode => data['failureCode'] as String?;
}

class ReferralShare {
  ReferralShare._(this.code, this.url, this.qr);
  final String code, url;
  final Uint8List qr;
  factory ReferralShare.parse(
    Map<String, dynamic> share,
    Map<String, dynamic> image,
  ) {
    final code = share['code'];
    final url = share['url'];
    final data = image['dataUrl'];
    if (code is! String ||
        !RegExp(r'^[a-f0-9]{32}$').hasMatch(code) ||
        url != 'https://www.flupflap.com/join?r=$code' ||
        data is! String ||
        data.length > 200000 ||
        !RegExp(r'^data:image/png;base64,[A-Za-z0-9+/=]+$').hasMatch(data)) {
      throw const FormatException('Invalid share');
    }
    final bytes = base64Decode(data.substring(22));
    if (bytes.length < 8 ||
        !const ListEqualityBytes().equals(bytes.sublist(0, 8), [
          137,
          80,
          78,
          71,
          13,
          10,
          26,
          10,
        ])) {
      throw const FormatException('Invalid QR');
    }
    return ReferralShare._(code, url as String, bytes);
  }
}

class ListEqualityBytes {
  const ListEqualityBytes();
  bool equals(List<int> a, List<int> b) =>
      a.length == b.length &&
      List.generate(a.length, (i) => a[i] == b[i]).every((v) => v);
}

/// Uses the existing isolated FlupFlap Dio; never a TiCash client or provider API.
class FlupFlapClient {
  FlupFlapClient(this.dio)
    : topups = MobileTopUpService(
        dio: dio,
        basePath: '/flupflap/mobile-topups',
      );
  final Dio dio;
  final MobileTopUpService topups;
  static const base = '/flupflap/mobile-topups';
  String? _visitCapability;
  Future<Map<String, dynamic>>? _visitFlight;
  int _capabilityEpoch = 0;
  void clearCapabilities() {
    _capabilityEpoch++;
    _visitCapability = null;
    _visitFlight = null;
  }

  Future<PaymentMethods> methods(MobileTopUpAvailability status) async =>
      PaymentMethods.parse(
        object((await dio.get('$base/payment-methods')).data),
        status,
      );
  Future<HostedSession> payment({
    required MobileTopUpQuote quote,
    required CheckoutMode mode,
    required String key,
    required bool guest,
    String? billingCountry,
    String? recipientId,
    int? recurringIntervalDays,
  }) async {
    if (guest && !RegExp(r'^[A-Z]{2}$').hasMatch(billingCountry ?? '')) {
      throw const FormatException('Billing country required');
    }
    if (recurringIntervalDays != null &&
        (guest || ![7, 15, 30].contains(recurringIntervalDays))) {
      throw const FormatException('Invalid recurring interval');
    }
    final data = object(
      (await dio.post(
        '$base/payment-sessions',
        data: {
          'quoteId': quote.id,
          'returnTarget': 'FLUPFLAP_ANDROID',
          if (guest) 'billingCountry': billingCountry,
          if (recipientId != null) 'recipientId': recipientId,
          if (recurringIntervalDays != null)
            'recurringIntervalDays': recurringIntervalDays,
        },
        options: Options(headers: {'Idempotency-Key': key}),
      )).data,
    );
    return HostedSession.parse(data, mode, moneyCents(quote.totalChargeUsd));
  }

  Future<RechargeResult> resume(String token) async {
    if (!resumeTokenPattern.hasMatch(token)) {
      throw const FormatException('Invalid resume capability');
    }
    return RechargeResult(
      object(
        object(
          (await dio.post(
            '$base/checkout-resume',
            data: {'resumeToken': token},
          )).data,
        )['transaction'],
      ),
    );
  }

  Future<RechargeResult> transaction(String id) async => RechargeResult(
    object(
      object(
        (await dio.get(
          '$base/transactions/${Uri.encodeComponent(id)}',
          queryParameters: {'refresh': true},
        )).data,
      )['transaction'],
    ),
  );
  Future<RechargeResult> cancelTransaction(
    String id, {
    bool onlyIfAbandoned = false,
  }) async => RechargeResult(
    object(
      object(
        (await dio.post(
          '$base/transactions/${Uri.encodeComponent(id)}/${onlyIfAbandoned ? 'cancel-abandoned' : 'cancel'}',
        )).data,
      )['transaction'],
    ),
  );
  Future<List<RechargeResult>> history() async =>
      (object((await dio.get('$base/transactions')).data)['transactions']
              as List)
          .map((v) => RechargeResult(object(v)))
          .toList();
  Future<Map<String, dynamic>?> promotion(String quoteId) async =>
      object(
            (await dio.get(
              '/flupflap/marketing/quotes/${Uri.encodeComponent(quoteId)}',
            )).data,
          )['promotion']
          as Map<String, dynamic>?;
  Future<Map<String, dynamic>> visit({String? promo, String? referral}) {
    final epoch = ++_capabilityEpoch;
    return _visitFlight = _visit(promo, referral, epoch);
  }

  Future<Map<String, dynamic>> _visit(
    String? promo,
    String? referral,
    int epoch,
  ) async {
    _visitCapability = null;
    final normalized = promo?.trim().toUpperCase();
    if (normalized != null &&
        !RegExp(r'^[A-Z0-9][A-Z0-9_-]{5,31}$').hasMatch(normalized)) {
      throw const FormatException('Invalid promotion');
    }
    if (referral != null && !RegExp(r'^[a-f0-9]{32}$').hasMatch(referral)) {
      throw const FormatException('Invalid referral');
    }
    final data = object(
      (await dio.post(
        '/flupflap/marketing/visits',
        data: {
          if (normalized != null) 'promo': normalized,
          if (referral != null) 'r': referral,
        },
      )).data,
    );
    if (data['capability'] is! String ||
        !RegExp(
          r'^[A-Za-z0-9_-]{43}$',
        ).hasMatch(data['capability'] as String)) {
      throw const FormatException('Invalid visit');
    }
    if (epoch == _capabilityEpoch) {
      _visitCapability = data['capability'] as String;
    }
    return data;
  }

  Future<void> signupStarted() async {
    await _visitFlight;
    if (_visitCapability != null) {
      await dio.post(
        '/flupflap/marketing/signup-started',
        data: {'capability': _visitCapability},
      );
    }
  }

  Future<void> claim() async {
    await _visitFlight;
    final capability = _visitCapability;
    if (capability == null) return;
    await dio.post(
      '/flupflap/marketing/attribution',
      data: {'capability': capability},
    );
    if (_visitCapability == capability) _visitCapability = null;
  }

  Future<List<RecurringRechargeSchedule>> recurringSchedules() async =>
      (object((await dio.get('/flupflap/recurring-recharges')).data)['schedules']
              as List)
          .map((v) => RecurringRechargeSchedule(object(v)))
          .toList();

  Future<RecurringRechargeSchedule> enableRecurring({
    required String transactionId,
    required int intervalDays,
  }) async {
    if (!_uuid.hasMatch(transactionId) || ![7, 15, 30].contains(intervalDays)) {
      throw const FormatException('Invalid recurring recharge');
    }
    final data = object(
      (await dio.post(
        '/flupflap/recurring-recharges',
        data: {
          'transactionId': transactionId,
          'intervalDays': intervalDays,
          'consent': true,
        },
      )).data,
    );
    return RecurringRechargeSchedule(object(data['schedule']));
  }

  Future<RecurringRechargeSchedule> updateRecurring({
    required String id,
    required String action,
  }) async {
    if (!_uuid.hasMatch(id) ||
        !['PAUSE', 'RESUME', 'CANCEL'].contains(action)) {
      throw const FormatException('Invalid recurring recharge action');
    }
    final data = object(
      (await dio.patch(
        '/flupflap/recurring-recharges/' + Uri.encodeComponent(id),
        data: {'action': action},
      )).data,
    );
    return RecurringRechargeSchedule(object(data['schedule']));
  }

  Future<ReferralShare> share({required bool guest}) async {
    if (guest) throw StateError('Registered account required');
    final share = object((await dio.get('/flupflap/marketing/share')).data);
    final qr = object((await dio.get('/flupflap/marketing/share/qr')).data);
    return ReferralShare.parse(share, qr);
  }
}