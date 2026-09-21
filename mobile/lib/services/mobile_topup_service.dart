import '../models/mobile_topup.dart';

abstract class MobileTopUpService {
  Future<List<MobileTopUpCountry>> countries();
  Future<List<MobileTopUpOperator>> operators(String countryCode);
  Future<MobileTopUpOperator> detectOperator(String countryCode, String phone);
  Future<List<MobileTopUpProduct>> products(String countryCode, int operatorId);
  Future<List<MobileTopUpRecipient>> recipients();
  Future<MobileTopUpRecipient> saveRecipient({
    required String countryCode,
    required String nickname,
    required String phone,
    int? operatorId,
    String? operatorName,
  });
  Future<MobileTopUpQuote> quote({
    required String countryCode,
    required String phone,
    required int operatorId,
    required String productId,
    double? amount,
  });
  Future<MobileTopUpTransaction> purchase({
    required String quoteId,
    String? recipientId,
  });
  Future<List<MobileTopUpTransaction>> history();
}

class UnconfiguredMobileTopUpService implements MobileTopUpService {
  const UnconfiguredMobileTopUpService();

  @override
  Future<List<MobileTopUpCountry>> countries() async => const [];

  @override
  Future<MobileTopUpOperator> detectOperator(String countryCode, String phone) async {
    throw UnsupportedError('Connect the mobile recharge API before detecting operators.');
  }

  @override
  Future<List<MobileTopUpTransaction>> history() async => const [];

  @override
  Future<List<MobileTopUpOperator>> operators(String countryCode) async => const [];

  @override
  Future<MobileTopUpTransaction> purchase({
    required String quoteId,
    String? recipientId,
  }) async {
    throw UnsupportedError('Connect the mobile recharge API before purchasing.');
  }

  @override
  Future<MobileTopUpQuote> quote({
    required String countryCode,
    required String phone,
    required int operatorId,
    required String productId,
    double? amount,
  }) async {
    throw UnsupportedError('Connect the mobile recharge API before requesting quotes.');
  }

  @override
  Future<List<MobileTopUpRecipient>> recipients() async => const [];

  @override
  Future<MobileTopUpRecipient> saveRecipient({
    required String countryCode,
    required String nickname,
    required String phone,
    int? operatorId,
    String? operatorName,
  }) async {
    throw UnsupportedError('Connect the mobile recharge API before saving recipients.');
  }

  @override
  Future<List<MobileTopUpProduct>> products(String countryCode, int operatorId) async => const [];
}
