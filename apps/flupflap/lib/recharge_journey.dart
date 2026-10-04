import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'checkout_contract.dart';

enum RechargeStep { destination, product, review, payment, recovery, result }

enum RechargeAmountIssue {
  empty,
  invalid,
  belowMinimum,
  aboveMaximum,
  precision,
  increment,
}

/// One session-owned controller survives tab navigation/browser handoff.
/// A request that may have reserved a payment never gets a new key on retry.
class RechargeJourney extends ChangeNotifier {
  RechargeJourney(
    this.client, {
    required this.guest,
    required this.storedBillingCountry,
    this.updateStoredBillingCountry,
    DateTime Function()? clock,
  }) : now = clock ?? DateTime.now;
  final FlupFlapClient client;
  final bool Function() guest;
  final String? Function() storedBillingCountry;
  final Future<void> Function(String)? updateStoredBillingCountry;
  final DateTime Function() now;
  RechargeStep step = RechargeStep.destination;
  MobileTopUpAvailability? availability;
  PaymentMethods? payments;
  List<MobileTopUpCountry> countries = [];
  List<MobileTopUpRecipient> recipients = [];
  List<MobileTopUpOperator> operators = [];
  List<MobileTopUpProduct> products = [];
  List<RechargeResult> history = [];
  List<RecurringRechargeSchedule> recurringSchedules = [];
  String? country, billingCountry, recipientId, error, notice;
  String phone = '', amount = '', nickname = '';
  int? recurringIntervalDays;
  bool internet = false;
  List<MobileTopUpOperator> get serviceOperators => operators
      .where((o) => o.internetService == internet).toList();

  void selectService(bool value) {
    _editable();
    if (step != RechargeStep.destination && step != RechargeStep.product) return;
    if (internet == value) return;
    internet = value;
    _revision++;
    operator = null;
    product = null;
    products = [];
    amount = '';
    _invalidateQuote();
    error = null;
    _emit();
  }

  MobileTopUpOperator? operator;
  MobileTopUpProduct? product;
  MobileTopUpQuote? quote;
  Map<String, dynamic>? promotion;
  String? appliedPromotionLabel, promotionError;
  HostedSession? hosted;
  RechargeResult? result;
  bool busy = false, reviewed = false, initialized = false;
  String? _attemptKey,
      _attemptQuote,
      _attemptRecipient,
      _attemptCountry,
      _transactionId,
      _resumeToken;
  CheckoutMode? _attemptMode;
  bool _attemptGuest = false, _disposed = false;
  int _revision = 0, _polls = 0;
  Timer? _timer, _quoteTimer;
  Future<void>? _refreshFlight;
  bool _cancelling = false;
  bool _historyCheckRequired = false;
  bool _checkingHistory = false;
  bool get canCancel =>
      locked &&
      result?.terminal != true &&
      _transactionId != null &&
      _resumeToken == null;
  bool get locked =>
      _historyCheckRequired ||
      _attemptKey != null ||
      _resumeToken != null ||
      (result != null && !result!.terminal);
  bool get quoteValid => quote != null && quote!.expiresAt.isAfter(now());
  bool get canPay =>
      !busy &&
      !locked &&
      initialized &&
      payments != null &&
      quoteValid &&
      reviewed &&
      (payments!.mode == CheckoutMode.mock ||
          RegExp(r'^[A-Z]{2}$').hasMatch(
            guest() ? billingCountry ?? '' : storedBillingCountry() ?? '',
          ));
  bool get canBack =>
      !busy &&
      !locked &&
      (step == RechargeStep.product || step == RechargeStep.review);

  bool get _validSelection =>
      country != null &&
      operator != null &&
      product != null &&
      products.contains(product) &&
      _validProduct(product!);

  bool get canReview =>
      !busy && !locked && initialized && _validSelection && amountIssue == null;

  RechargeAmountIssue? get amountIssue {
    final p = product;
    if (p == null || p.amountType != 'RANGE') return null;
    if (!_validProduct(p)) return RechargeAmountIssue.invalid;
    if (amount.isEmpty) return RechargeAmountIssue.empty;
    if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(amount)) {
      return RechargeAmountIssue.invalid;
    }
    final value = double.tryParse(amount);
    if (value == null || !value.isFinite) return RechargeAmountIssue.invalid;
    if (value < p.minimumAmount!) return RechargeAmountIssue.belowMinimum;
    if (value > p.maximumAmount!) return RechargeAmountIssue.aboveMaximum;
    final cents = moneyCents(value);
    final precision = p.amountPrecision ?? 2;
    if (precision == 0 && cents % 100 != 0 ||
        precision == 1 && cents % 10 != 0) {
      return RechargeAmountIssue.precision;
    }
    if (p.amountIncrement != null &&
        (cents - moneyCents(p.minimumAmount!)) %
                moneyCents(p.amountIncrement!) !=
            0) {
      return RechargeAmountIssue.increment;
    }
    return null;
  }

  bool _validProduct(MobileTopUpProduct p) {
    if (p.id.trim().isEmpty ||
        p.operatorId != operator?.id ||
        !RegExp(r'^[A-Z]{3}$').hasMatch(p.priceCurrency)) {
      return false;
    }
    try {
      if (moneyCents(p.price) <= 0) return false;
      if (p.amountType == 'FIXED') return true;
      if (p.amountType != 'RANGE' ||
          p.kind != MobileTopUpKind.airtime ||
          p.minimumAmount == null ||
          p.maximumAmount == null ||
          moneyCents(p.minimumAmount!) <= 0 ||
          moneyCents(p.maximumAmount!) < moneyCents(p.minimumAmount!)) {
        return false;
      }
      final precision = p.amountPrecision ?? 2;
      return precision >= 0 &&
          precision <= 2 &&
          (p.amountIncrement == null || moneyCents(p.amountIncrement!) > 0);
    } on FormatException {
      return false;
    }
  }

  void _setProducts(List<MobileTopUpProduct> catalog) {
    products = catalog.where(_validProduct).toList();
    // A lone airtime offer needs no extra confirmation tap. Do not choose
    // between multiple valid offers, even across different product kinds.
    product =
        products.length == 1 && products.single.kind == MobileTopUpKind.airtime
        ? products.single
        : null;
    amount = '';
  }

  void _emit() {
    if (!_disposed) notifyListeners();
  }

  String safeError(Object e) {
    final data = e is DioException ? e.response?.data : null;
    final code = data is Map ? data['code'] : null;
    return switch (code) {
      'TOPUP_QUOTE_EXPIRED' || 'TOPUP_QUOTE_ALREADY_USED' => 'quoteExpired',
      'TOPUP_CATALOG_CHANGED' || 'TOPUP_QUOTE_CHANGED' => 'catalogChanged',
      'BILLING_COUNTRY_REQUIRED' => 'billingRequired',
      'RECURRING_PAYMENT_METHOD_UNAVAILABLE' ||
      'RECURRING_SOURCE_NOT_ELIGIBLE' => 'recurringPaymentUnavailable',
      'TOPUP_NOT_CANCELLABLE' ||
      'TOPUP_CANCELLATION_UNRESOLVED' => 'cancellationUnresolved',
      'GUEST_SCOPE_RESTRICTED' || 'FORBIDDEN' => 'accountRequired',
      'INSUFFICIENT_FUNDS' => 'insufficientFunds',
      'PAYMENT_DECLINED' => 'paymentDeclined',
      'RESUME_TOKEN_EXPIRED' || 'RESUME_TOKEN_NOT_FOUND' => 'resumeUnavailable',
      _ => 'requestFailed',
    };
  }

  Future<void> _run(Future<void> Function(int) action) async {
    if (busy || _disposed) return;
    busy = true;
    error = null;
    _emit();
    final version = _revision;
    try {
      await action(version);
    } catch (e) {
      if (version == _revision) {
        error = safeError(e);
        if (_historyCheckRequired) step = RechargeStep.recovery;
      }
    } finally {
      if (!_disposed) {
        busy = false;
        _emit();
      }
    }
  }

  bool _current(int revision) => !_disposed && revision == _revision;
  Future<void> initialize() => _run((v) async {
    final status = await client.topups.availability();
    if (!_current(v)) return;
    availability = status;
    await _checkHistory(v);
    if (!_current(v)) return;
    countries = await client.topups.countries();
    recipients = await client.topups.recipients();
    payments = await client.methods(status);
    if (status.recurringRechargeEnabled && !guest()) {
      try {
        recurringSchedules = await client.recurringSchedules();
      } catch (_) {
        recurringSchedules = [];
      }
    } else {
      recurringSchedules = [];
    }
    if (_current(v)) initialized = true;
  });

  Future<void> _checkHistory(int v) async {
    _checkingHistory = true;
    _historyCheckRequired = true;
    _timer?.cancel();
    try {
      final existing = await client.history();
      if (_current(v)) await _recoverHistory(existing, v);
    } catch (e) {
      if (_current(v)) {
        step = RechargeStep.recovery;
        error = safeError(e);
      }
    } finally {
      _checkingHistory = false;
      if (_current(v) && locked) _schedule();
    }
  }

  Future<void> _recoverHistory(List<RechargeResult> existing, int v) async {
    history = existing;
    _historyCheckRequired = true;
    RechargeResult? blocker;
    String? recoveryError;
    final hadRecovery =
        result != null ||
        step == RechargeStep.recovery ||
        existing.any((t) => !t.terminal);
    for (final pending in existing.where((t) => !t.terminal)) {
      if (!_current(v)) return;
      var unresolved = pending;
      // Fail closed on refresh errors or missing IDs; never unlock from a guess.
      try {
        if (pending.id == null) {
          throw const FormatException('Missing transaction');
        }
        var updated = await client.transaction(pending.id!);
        if (!_current(v)) return;
        if (updated.id != pending.id) {
          throw const FormatException('Transaction mismatch');
        }
        _updateHistory(updated);
        unresolved = updated;
        if (updated.abandonedReservation) {
          final cancelled = await client.cancelTransaction(
            pending.id!,
            onlyIfAbandoned: true,
          );
          if (!_current(v)) return;
          _confirmCancellation(cancelled, pending.id!);
          updated = cancelled;
          _updateHistory(updated);
        }
        if (!updated.terminal) blocker ??= updated;
      } catch (e) {
        blocker ??= unresolved;
        recoveryError ??= safeError(e);
      }
    }
    if (!_current(v)) return;
    // Do not stop at the first genuine payment: later safe orphans still need
    // cleanup. Never render recovery for a reservation successfully cancelled.
    _historyCheckRequired = blocker != null;
    if (blocker != null) {
      result = blocker;
      _transactionId = blocker.id;
      step = RechargeStep.recovery;
      error = recoveryError;
      _schedule();
    } else if (hadRecovery) {
      _resetDestination();
    }
  }

  void _confirmCancellation(RechargeResult cancelled, String id) {
    if (cancelled.id != id ||
        cancelled.status != 'FAILED' ||
        cancelled.paymentStatus != 'FAILED' ||
        cancelled.data['failureCode'] != 'CANCELLED_BY_CUSTOMER') {
      throw const FormatException('Cancellation not confirmed');
    }
  }

  void _updateHistory(RechargeResult updated) {
    history = history
        .map((item) => item.id == updated.id ? updated : item)
        .toList();
  }

  // Re-entering Recharge never reopens an old terminal receipt. Active steps
  // and unresolved attempts are retained, including fresh repeat quotes.
  Future<void> enterRecharge() async {
    // An in-memory attempt (including an unknown create response) is never an
    // abandoned historical reservation. Preserve its idempotency key/session.
    if (busy || _attemptKey != null || _resumeToken != null) return;
    await _run((v) async {
      await _refreshFlight;
      if (_current(v)) await _checkHistory(v);
    });
  }

  void _editable() {
    if (locked || busy) throw StateError('Resolve pending checkout first');
  }

  void _invalidateQuote() {
    _quoteTimer?.cancel();
    quote = null;
    promotion = null;
    reviewed = false;
    hosted = null;
  }

  void _watchQuote() {
    _quoteTimer?.cancel();
    final delay = quote!.expiresAt.difference(now());
    if (!delay.isNegative) _quoteTimer = Timer(delay, _emit);
  }

  void destination({
    required String code,
    required String number,
    String? savedId,
  }) {
    _editable();
    _revision++;
    country = code;
    phone = number;
    recipientId = savedId;
    operator = null;
    product = null;
    operators = [];
    products = [];
    amount = '';
    _invalidateQuote();
    step = RechargeStep.destination;
    error = null;
    _emit();
  }

  void selectRecipient(MobileTopUpRecipient r) =>
      destination(code: r.countryCode, number: r.phone, savedId: r.id);
  void setAmount(String value) {
    _editable();
    amount = value;
    _revision++;
    _invalidateQuote();
    _emit();
  }

  void setBillingCountry(String? value) {
    _editable();
    billingCountry = value;
    reviewed = false;
    _emit();
  }

  Future<void> chooseBillingCountry(String value) async {
    _editable();
    if (!RegExp(r'^[A-Z]{2}$').hasMatch(value)) {
      throw const FormatException('Invalid billing country');
    }
    if (guest()) {
      setBillingCountry(value);
      return;
    }
    final update = updateStoredBillingCountry;
    if (update == null) throw StateError('Billing country update unavailable');
    busy = true;
    reviewed = false;
    _emit();
    try {
      await update(value);
    } finally {
      busy = false;
      _emit();
    }
  }

  void setRecurringInterval(int? days) {
    _editable();
    if (days != null &&
        (guest() ||
            availability?.recurringRechargeEnabled != true ||
            ![7, 15, 30].contains(days))) {
      throw StateError('Recurring recharge unavailable');
    }
    recurringIntervalDays = days;
    reviewed = false;
    _emit();
  }

  void confirmReview(bool value) {
    reviewed = value;
    _emit();
  }

  Future<void> back() async {
    if (!canBack) return;
    reviewed = false;
    if (step == RechargeStep.review && product == null) {
      // Repeat starts with a server quote rather than a selected catalog item.
      // Load the destination catalog so Back still opens Operator & Product.
      await continueDestination();
      return;
    }
    step = step == RechargeStep.review
        ? RechargeStep.product
        : RechargeStep.destination;
    _emit();
  }

  Future<void> continueDestination() => _run((v) async {
    if (country == null ||
        !countries.any((c) => c.code == country) ||
        !RegExp(
          r'^\+[1-9][0-9]{6,14}$',
        ).hasMatch(phone.replaceAll(RegExp(r'[\s().-]'), ''))) {
      throw const FormatException('Invalid destination');
    }
    phone = phone.replaceAll(RegExp(r'[\s().-]'), '');
    final list = await client.topups.operators(country!);
    MobileTopUpOperator? detected;
    try {
      detected = await client.topups.detectOperator(
        countryCode: country!,
        phone: phone,
      );
    } catch (_) {
      /* Provider detection may require manual selection. */
    }
    if (!_current(v)) return;
    operators = list;
    operator = detected == null
        ? null
        : list
              .where((o) => o.id == detected!.id && o.countryCode == country && o.internetService == internet)
              .firstOrNull;
    product = null;
    products = [];
    _invalidateQuote();
    step = RechargeStep.product;
    if (operator != null) {
      final catalog = await client.topups.products(country!, operator!.id);
      if (_current(v)) _setProducts(catalog);
    }
  });
  Future<void> selectOperator(MobileTopUpOperator value) => _run((v) async {
    if (locked || !serviceOperators.contains(value) || value.countryCode != country) {
      throw StateError('Invalid operator');
    }
    operator = value;
    product = null;
    products = [];
    amount = '';
    _invalidateQuote();
    final list = await client.topups.products(country!, value.id);
    if (_current(v)) _setProducts(list);
  });
  void selectProduct(MobileTopUpProduct value) {
    _editable();
    if (!products.contains(value) || !_validProduct(value)) {
      throw StateError('Invalid product');
    }
    product = value;
    amount = '';
    _revision++;
    _invalidateQuote();
    _emit();
  }

  double? _rangeAmount() {
    if (product?.amountType != 'RANGE') return null;
    if (amountIssue != null) {
      throw const FormatException('Invalid amount');
    }
    return double.parse(amount);
  }

  Future<void> review() => _run((v) async {
    if (locked || !_validSelection) {
      throw StateError('Select product');
    }
    final q = await client.topups.quote(
      countryCode: country!,
      phone: phone,
      operatorId: operator!.id,
      productId: product!.id,
      amount: _rangeAmount(),
      catalogVersion: product!.catalogVersion,
    );
    if (!_current(v)) return;
    if (q.countryCode != country ||
        q.phone != phone ||
        q.operatorId != operator!.id ||
        q.productId != product!.id) {
      throw const FormatException('Quote binding mismatch');
    }
    quote = q;
    _watchQuote();
    reviewed = false;
    step = RechargeStep.review;
    promotion = null;
    try {
      final details = await client.promotion(q.id);
      promotion = details == null ? q.promotion : {...?q.promotion, ...details};
    } on DioException catch (e) {
      if (![404, 503].contains(e.response?.statusCode)) rethrow;
    }
  });
  Future<void> applyPromotion(String code) => _run((v) async {
    if (locked) throw StateError('Checkout locked');
    _invalidateQuote();
    appliedPromotionLabel = null;
    promotionError = null;
    notice = null;
    try {
      final visit = await client.visit(promo: code);
      await client.claim();
      if (_current(v)) {
        final details = visit['promotion'];
        appliedPromotionLabel = details is Map && details['name'] is String
            ? details['name'] as String
            : code.trim().toUpperCase();
        notice = 'promotionApplied';
        step = RechargeStep.product;
      }
    } catch (e) {
      if (_current(v)) {
        final status = e is DioException ? e.response?.statusCode : null;
        promotionError = e is FormatException || status == 400 || status == 409
            ? 'promoUnavailable'
            : 'requestFailed';
      }
    }
  });
  Future<void> pay() => _run((v) async {
    if (locked ||
        !initialized ||
        payments == null ||
        !quoteValid ||
        !reviewed) {
      throw StateError('Review required');
    }
    final status = await client.topups.availability();
    final methods = await client.methods(status);
    if (!_current(v)) return;
    if (methods.mode != payments!.mode) {
      throw const FormatException('Payment mode changed');
    }
    final billing = guest() ? billingCountry : storedBillingCountry();
    if (methods.mode != CheckoutMode.mock &&
        !RegExp(r'^[A-Z]{2}$').hasMatch(billing ?? '')) {
      throw const FormatException('Billing required');
    }
    if (nickname.trim().isNotEmpty && recipientId == null) {
      final r = await client.topups.saveRecipient(
        nickname: nickname.trim(),
        phone: quote!.phone,
        countryCode: quote!.countryCode,
        operator: operator,
      );
      recipientId = r.id;
    }
    if (!_current(v)) return;
    // Reserve the key BEFORE dispatch; keep it even on timeout/unknown failures.
    _quoteTimer?.cancel();
    _attemptKey = newAttemptKey();
    _attemptQuote = quote!.id;
    _attemptRecipient = recipientId;
    _attemptCountry = billing;
    _attemptGuest = guest();
    _attemptMode = methods.mode;
    step = RechargeStep.payment;
    await _submit();
  });
  Future<void> retryPayment() => _run((v) async {
    if (_attemptKey == null || result?.terminal == true) return;
    await _submit();
  });
  Future<void> _submit() async {
    if (_disposed) return;
    if (_attemptMode == CheckoutMode.mock) {
      final t = await client.topups.purchase(
        quoteId: _attemptQuote!,
        idempotencyKey: _attemptKey!,
        recipientId: _attemptRecipient,
      );
      // Read canonical server state; no local inference from HTTP success.
      _transactionId = t.id;
      await refresh();
    } else {
      final session = await client.payment(
        quote: quote!,
        mode: _attemptMode!,
        key: _attemptKey!,
        guest: _attemptGuest,
        billingCountry: _attemptCountry,
        recipientId: _attemptRecipient,
        recurringIntervalDays: recurringIntervalDays,
      );
      if (_transactionId != null && _transactionId != session.transactionId) {
        throw const FormatException('Attempt binding mismatch');
      }
      hosted = session;
      _transactionId = session.transactionId;
      _schedule();
    }
  }

  Future<void> refresh() {
    if (_disposed || _cancelling || _checkingHistory) return Future.value();
    return _refreshFlight ??= _refresh().whenComplete(
      () => _refreshFlight = null,
    );
  }

  Future<void> _refresh() async {
    final v = _revision;
    final recovering =
        (step == RechargeStep.recovery || _historyCheckRequired) &&
        _attemptKey == null &&
        _resumeToken == null;
    try {
      if (recovering) {
        await _checkHistory(v);
        if (_current(v)) {
          initialized = availability != null && payments != null;
          _emit();
        }
        return;
      }
      final updated = _resumeToken != null
          ? await client.resume(_resumeToken!)
          : _transactionId != null
          ? await client.transaction(_transactionId!)
          : null;
      if (!_current(v) || updated == null) return;
      if (_resumeToken == null && updated.id != _transactionId) {
        throw const FormatException('Transaction mismatch');
      }
      result = updated;
      _updateHistory(updated);
      step = updated.terminal ? RechargeStep.result : RechargeStep.recovery;
      if (updated.terminal) {
        _timer?.cancel();
        _resumeToken = null;
        _attemptKey = null;
        hosted = null;
      }
      _emit();
      _schedule();
    } catch (e) {
      if (_current(v)) {
        error = safeError(e);
        _emit();
        _schedule();
      }
    }
  }

  Future<void> cancelPending() => _run((v) async {
    if (!canCancel) throw StateError('Authenticated transaction required');
    final id = _transactionId!;
    _cancelling = true;
    _timer?.cancel();
    try {
      await _refreshFlight;
      if (!_current(v) || !canCancel || _transactionId != id) return;
      final cancelled = await client.cancelTransaction(id);
      if (!_current(v)) return;
      _confirmCancellation(cancelled, id);
      result = cancelled;
      _updateHistory(cancelled);
      _attemptKey = null;
      _resumeToken = null;
      hosted = null;
      // Keep the lock if loading the remaining history fails.
      initialized = false;
      _historyCheckRequired = true;
      step = RechargeStep.recovery;
      final existing = await client.history();
      if (!_current(v)) return;
      _resetDestination();
      await _recoverHistory(existing, v);
      if (!_current(v)) return;
      if (!locked) {
        _resetDestination();
        notice = 'cancelledStartNew';
      }
      initialized = availability != null && payments != null;
    } finally {
      _cancelling = false;
      if (locked) _schedule();
    }
  });

  Future<void> resume(String token) async {
    if (!resumeTokenPattern.hasMatch(token)) {
      error = 'resumeUnavailable';
      _emit();
      return;
    }
    _timer?.cancel();
    final v = ++_revision;
    _resumeToken = token;
    result = null;
    hosted = null;
    _polls = 0;
    step = RechargeStep.recovery;
    _emit();
    // An older status request cannot populate a newer return capability.
    await _refreshFlight;
    if (_current(v)) await refresh();
  }

  void _schedule() {
    if (_disposed ||
        _timer?.isActive == true ||
        _polls >= 24 ||
        (result?.terminal == true && !_historyCheckRequired) ||
        (_transactionId == null && _resumeToken == null)) {
      return;
    }
    _timer = Timer(const Duration(seconds: 5), () {
      _polls++;
      refresh();
    });
  }

  RecurringRechargeSchedule? recurringFor(String transactionId) {
    for (final schedule in recurringSchedules) {
      if (schedule.data['sourceTransactionId'] == transactionId &&
          schedule.status != 'CANCELLED') {
        return schedule;
      }
    }
    return null;
  }

  Future<void> enableRecurring(String transactionId, int intervalDays) =>
      _run((v) async {
        if (guest() ||
            availability?.recurringRechargeEnabled != true ||
            ![7, 15, 30].contains(intervalDays)) {
          throw StateError('Recurring recharge unavailable');
        }
        final schedule = await client.enableRecurring(
          transactionId: transactionId,
          intervalDays: intervalDays,
        );
        if (!_current(v)) return;
        recurringSchedules = [
          schedule,
          ...recurringSchedules.where((s) => s.id != schedule.id),
        ];
        notice = 'recurringEnabled';
      });

  Future<void> updateRecurring(String id, String action) => _run((v) async {
    if (guest() || !['PAUSE', 'RESUME', 'CANCEL'].contains(action)) {
      throw StateError('Recurring recharge unavailable');
    }
    final schedule = await client.updateRecurring(id: id, action: action);
    if (!_current(v)) return;
    recurringSchedules = [
      schedule,
      ...recurringSchedules.where((s) => s.id != schedule.id),
    ];
    notice = action == 'PAUSE'
        ? 'recurringPaused'
        : action == 'RESUME'
        ? 'recurringResumed'
        : 'recurringCancelled';
  });

  Future<void> loadHistory() => _run((v) async {
    final list = await client.history();
    if (_current(v)) history = list;
  });
  Future<void> repeat(RechargeResult prior) => _run((v) async {
    if (locked || prior.id == null || !prior.terminal) {
      throw StateError('Unresolved recharge');
    }
    final q = await client.topups.repeat(prior.id!);
    if (!_current(v)) return;
    // A repeat is a new reviewed reservation, not a replay of the completed one.
    _timer?.cancel();
    _polls = 0;
    _transactionId = null;
    _attemptQuote = null;
    _attemptRecipient = null;
    _attemptCountry = null;
    _attemptMode = null;
    hosted = null;
    quote = q;
    _watchQuote();
    country = q.countryCode;
    phone = q.phone;
    recipientId = null;
    operator = null;
    product = null;
    promotion = null;
    reviewed = false;
    result = null;
    step = RechargeStep.review;
    try {
      final details = await client.promotion(q.id);
      promotion = details == null ? q.promotion : {...?q.promotion, ...details};
    } on DioException catch (e) {
      if (![404, 503].contains(e.response?.statusCode)) rethrow;
    }
  });
  void startAnother() {
    _editable();
    _revision++;
    _resetDestination();
    _emit();
  }

  void _resetDestination() {
    _timer?.cancel();
    _polls = 0;
    _transactionId = null;
    _attemptQuote = null;
    _attemptKey = null;
    _attemptRecipient = null;
    _attemptCountry = null;
    _attemptMode = null;
    _resumeToken = null;
    result = null;
    hosted = null;
    country = null;
    phone = '';
    operator = null;
    product = null;
    products = [];
    operators = [];
    recipientId = null;
    nickname = '';
    amount = '';
    recurringIntervalDays = null;
    error = null;
    notice = null;
    appliedPromotionLabel = null;
    promotionError = null;
    _invalidateQuote();
    step = RechargeStep.destination;
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _quoteTimer?.cancel();
    _resumeToken = null;
    super.dispose();
  }
}
