import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/mobile_topup.dart';
import '../services/mobile_topup_service.dart';

T? _firstWhereOrNull<T>(Iterable<T> values, bool Function(T value) test) {
  for (final value in values) {
    if (test(value)) return value;
  }
  return null;
}

class MobileTopUpState {
  const MobileTopUpState({
    this.loading = false,
    this.submitting = false,
    this.error,
    this.countries = const [],
    this.selectedCountry,
    this.phone = '',
    this.operator,
    this.products = const [],
    this.selectedProduct,
    this.savedRecipients = const [],
    this.selectedRecipient,
    this.quote,
    this.receipt,
    this.history = const [],
  });

  final bool loading;
  final bool submitting;
  final String? error;
  final List<MobileTopUpCountry> countries;
  final MobileTopUpCountry? selectedCountry;
  final String phone;
  final MobileTopUpOperator? operator;
  final List<MobileTopUpProduct> products;
  final MobileTopUpProduct? selectedProduct;
  final List<MobileTopUpRecipient> savedRecipients;
  final MobileTopUpRecipient? selectedRecipient;
  final MobileTopUpQuote? quote;
  final MobileTopUpTransaction? receipt;
  final List<MobileTopUpTransaction> history;

  MobileTopUpState copyWith({
    bool? loading,
    bool? submitting,
    String? error,
    bool clearError = false,
    List<MobileTopUpCountry>? countries,
    MobileTopUpCountry? selectedCountry,
    bool clearSelectedCountry = false,
    String? phone,
    MobileTopUpOperator? operator,
    bool clearOperator = false,
    List<MobileTopUpProduct>? products,
    MobileTopUpProduct? selectedProduct,
    bool clearSelectedProduct = false,
    List<MobileTopUpRecipient>? savedRecipients,
    MobileTopUpRecipient? selectedRecipient,
    bool clearSelectedRecipient = false,
    MobileTopUpQuote? quote,
    bool clearQuote = false,
    MobileTopUpTransaction? receipt,
    bool clearReceipt = false,
    List<MobileTopUpTransaction>? history,
  }) {
    return MobileTopUpState(
      loading: loading ?? this.loading,
      submitting: submitting ?? this.submitting,
      error: clearError ? null : (error ?? this.error),
      countries: countries ?? this.countries,
      selectedCountry: clearSelectedCountry
          ? null
          : (selectedCountry ?? this.selectedCountry),
      phone: phone ?? this.phone,
      operator: clearOperator ? null : (operator ?? this.operator),
      products: products ?? this.products,
      selectedProduct: clearSelectedProduct
          ? null
          : (selectedProduct ?? this.selectedProduct),
      savedRecipients: savedRecipients ?? this.savedRecipients,
      selectedRecipient: clearSelectedRecipient
          ? null
          : (selectedRecipient ?? this.selectedRecipient),
      quote: clearQuote ? null : (quote ?? this.quote),
      receipt: clearReceipt ? null : (receipt ?? this.receipt),
      history: history ?? this.history,
    );
  }
}

class MobileTopUpController extends StateNotifier<MobileTopUpState> {
  MobileTopUpController(this._service) : super(const MobileTopUpState(loading: true)) {
    load();
  }

  final MobileTopUpService _service;

  Future<void> load() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      final countries = await _service.countries();
      final recipients = await _service.recipients();
      final history = await _service.history();
      state = state.copyWith(
        loading: false,
        countries: countries,
        savedRecipients: recipients,
        history: history,
        selectedCountry: countries.isEmpty ? null : countries.first,
        clearError: true,
      );
    } catch (error) {
      state = state.copyWith(
        loading: false,
        error: error.toString(),
        countries: const [],
        savedRecipients: const [],
        history: const [],
      );
    }
  }

  void updatePhone(String phone) {
    state = state.copyWith(
      phone: phone,
      clearOperator: true,
      products: const [],
      clearSelectedProduct: true,
      clearQuote: true,
      clearReceipt: true,
      clearError: true,
      clearSelectedRecipient: true,
    );
  }

  void selectCountry(MobileTopUpCountry country) {
    state = state.copyWith(
      selectedCountry: country,
      phone: '',
      clearOperator: true,
      products: const [],
      clearSelectedProduct: true,
      clearQuote: true,
      clearReceipt: true,
      clearSelectedRecipient: true,
      clearError: true,
    );
  }

  void selectProduct(MobileTopUpProduct product) {
    state = state.copyWith(
      selectedProduct: product,
      clearQuote: true,
      clearReceipt: true,
      clearError: true,
    );
  }

  Future<void> detectOperator() async {
    final country = state.selectedCountry;
    if (country == null || state.phone.trim().isEmpty) {
      state = state.copyWith(error: 'Select a destination country and phone number first.');
      return;
    }
    final requestCountryCode = country.code;
    final requestPhone = state.phone;
    state = state.copyWith(loading: true, clearError: true, clearQuote: true, clearReceipt: true);
    try {
      final detected = await _service.detectOperator(requestCountryCode, requestPhone);
      final products = await _service.products(requestCountryCode, detected.id);
      if (state.selectedCountry?.code != requestCountryCode || state.phone != requestPhone) {
        return;
      }
      state = state.copyWith(
        loading: false,
        operator: detected,
        products: products,
        clearSelectedProduct: true,
        clearSelectedRecipient: true,
      );
    } catch (error) {
      state = state.copyWith(
        loading: false,
        error: error.toString(),
        clearOperator: true,
        products: const [],
        clearSelectedProduct: true,
      );
    }
  }

  Future<void> loadRecipient(MobileTopUpRecipient recipient) async {
    final countries = state.countries.isEmpty ? await _service.countries() : state.countries;
    final country = _firstWhereOrNull(countries, (item) => item.code == recipient.countryCode) ??
        MobileTopUpCountry(code: recipient.countryCode, name: recipient.countryCode);
    final requestedCountryCode = country.code;
    final requestedPhone = recipient.phone;
    state = state.copyWith(
      loading: true,
      selectedCountry: country,
      phone: recipient.phone,
      selectedRecipient: recipient,
      clearOperator: true,
      products: const [],
      clearSelectedProduct: true,
      clearQuote: true,
      clearReceipt: true,
      clearError: true,
    );
    try {
      final operator = recipient.operatorId == null
          ? await _service.detectOperator(country.code, recipient.phone)
          : _firstWhereOrNull(
                  await _service.operators(country.code),
                  (item) => item.id == recipient.operatorId,
                ) ??
                await _service.detectOperator(country.code, recipient.phone);
      final products = await _service.products(country.code, operator.id);
      if (state.selectedCountry?.code != requestedCountryCode || state.phone != requestedPhone) {
        return;
      }
      state = state.copyWith(
        loading: false,
        countries: countries,
        operator: operator,
        products: products,
        selectedProduct: recipient.lastProductId == null
            ? null
            : _firstWhereOrNull(products, (item) => item.id == recipient.lastProductId),
      );
    } catch (error) {
      state = state.copyWith(
        loading: false,
        countries: countries,
        error: error.toString(),
      );
    }
  }

  Future<void> requestQuote() async {
    final country = state.selectedCountry;
    final operator = state.operator;
    final product = state.selectedProduct;
    if (country == null || operator == null || product == null || state.phone.trim().isEmpty) {
      state = state.copyWith(error: 'Select a country, detect an operator, and choose a product first.');
      return;
    }
    final requestCountryCode = country.code;
    final requestPhone = state.phone;
    final requestProductId = product.id;
    state = state.copyWith(submitting: true, clearError: true, clearQuote: true, clearReceipt: true);
    try {
      final quote = await _service.quote(
        countryCode: requestCountryCode,
        phone: requestPhone,
        operatorId: operator.id,
        productId: requestProductId,
      );
      if (state.selectedCountry?.code != requestCountryCode ||
          state.phone != requestPhone ||
          state.selectedProduct?.id != requestProductId) {
        return;
      }
      state = state.copyWith(submitting: false, quote: quote);
    } catch (error) {
      state = state.copyWith(submitting: false, error: error.toString());
    }
  }

  Future<void> purchase() async {
    final quote = state.quote;
    if (quote == null) {
      state = state.copyWith(error: 'Request a quote before confirming a recharge.');
      return;
    }
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final receipt = await _service.purchase(
        quoteId: quote.id,
        recipientId: state.selectedRecipient?.id,
      );
      state = state.copyWith(
        submitting: false,
        receipt: receipt,
        history: [receipt, ...state.history],
      );
    } catch (error) {
      state = state.copyWith(submitting: false, error: error.toString());
    }
  }
}

final mobileTopUpServiceProvider = Provider<MobileTopUpService>(
  (ref) => const UnconfiguredMobileTopUpService(),
);

final mobileTopUpControllerProvider =
    StateNotifierProvider<MobileTopUpController, MobileTopUpState>(
  (ref) => MobileTopUpController(ref.watch(mobileTopUpServiceProvider)),
);
