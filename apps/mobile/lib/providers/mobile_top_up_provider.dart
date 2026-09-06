import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/mobile_top_up.dart';
import '../services/mobile_top_up_service.dart';

final mobileTopUpServiceProvider = Provider<MobileTopUpService>(
  (ref) => MobileTopUpService(),
);
final mobileTopUpAvailabilityProvider = FutureProvider<MobileTopUpAvailability>(
  (ref) => ref.watch(mobileTopUpServiceProvider).availability(),
);
final mobileTopUpHistoryProvider = FutureProvider<List<MobileTopUpTransaction>>(
  (ref) => ref.watch(mobileTopUpServiceProvider).history(),
);
final mobileTopUpRecipientsProvider =
    FutureProvider<List<MobileTopUpRecipient>>(
      (ref) => ref.watch(mobileTopUpServiceProvider).recipients(),
    );
