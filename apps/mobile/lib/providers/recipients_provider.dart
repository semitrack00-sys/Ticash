import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/recipient.dart';

/// In-memory list of the user's saved recipients.
///
/// This will be backed by the API/local cache once the recipients
/// endpoints are implemented in Phase 2 feature work.
class RecipientsNotifier extends StateNotifier<List<Recipient>> {
  RecipientsNotifier() : super(const []);

  void setRecipients(List<Recipient> recipients) {
    state = recipients;
  }

  void addRecipient(Recipient recipient) {
    state = [...state, recipient];
  }

  void removeRecipient(String recipientId) {
    state = state.where((r) => r.id != recipientId).toList();
  }
}

final recipientsProvider =
    StateNotifierProvider<RecipientsNotifier, List<Recipient>>(
  (ref) => RecipientsNotifier(),
);
