import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/recipient.dart';
import '../services/recipients_service.dart';

/// API-backed list of the user's saved recipients.
class RecipientsNotifier extends StateNotifier<AsyncValue<List<Recipient>>> {
  RecipientsNotifier(this._service) : super(const AsyncValue.loading()) {
    load();
  }

  final RecipientsService _service;

  Future<void> load() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_service.list);
  }

  void setRecipients(List<Recipient> recipients) {
    state = AsyncValue.data(recipients);
  }

  Future<void> addRecipient({
    required String firstName,
    String? middleName,
    required String lastName,
    required String phoneNumber,
    required String payoutMethod,
    required String address,
    required String city,
    required String department,
  }) async {
    final recipient = await _service.create(
      firstName: firstName,
      middleName: middleName,
      lastName: lastName,
      phoneNumber: phoneNumber,
      payoutMethod: payoutMethod,
      address: address,
      city: city,
      department: department,
    );
    state = AsyncValue.data([
      ...(state.valueOrNull ?? const <Recipient>[]),
      recipient,
    ]);
  }

  Future<void> removeRecipient(String recipientId) async {
    await _service.delete(recipientId);
    state = AsyncValue.data(
      (state.valueOrNull ?? const <Recipient>[])
          .where((recipient) => recipient.id != recipientId)
          .toList(),
    );
  }

  Future<void> updateRecipient({
    required String recipientId,
    required String firstName,
    String? middleName,
    required String lastName,
    required String phoneNumber,
    required String payoutMethod,
    required String address,
    required String city,
    required String department,
  }) async {
    final updated = await _service.update(
      recipientId: recipientId,
      firstName: firstName,
      middleName: middleName,
      lastName: lastName,
      phoneNumber: phoneNumber,
      payoutMethod: payoutMethod,
      address: address,
      city: city,
      department: department,
    );
    state = AsyncValue.data(
      (state.valueOrNull ?? const <Recipient>[])
          .map((item) => item.id == recipientId ? updated : item)
          .toList(),
    );
  }
}

final recipientsServiceProvider = Provider((ref) => RecipientsService());

final recipientsProvider =
    StateNotifierProvider<RecipientsNotifier, AsyncValue<List<Recipient>>>(
      (ref) => RecipientsNotifier(ref.watch(recipientsServiceProvider)),
    );
