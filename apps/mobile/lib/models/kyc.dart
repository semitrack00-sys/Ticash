import 'user.dart';

class KycSession {
  const KycSession({
    required this.sessionId,
    required this.sessionToken,
    required this.status,
  });

  final String sessionId;
  final String sessionToken;
  final KycStatus status;

  factory KycSession.fromJson(Map<String, dynamic> json) => KycSession(
    sessionId: json['sessionId'] as String,
    sessionToken: json['sessionToken'] as String,
    status: KycStatus.fromApi(json['status'] as String?),
  );
}

class KycStatusSnapshot {
  const KycStatusSnapshot({
    required this.status,
    this.startedAt,
    this.verifiedAt,
    this.failureReason,
  });

  final KycStatus status;
  final DateTime? startedAt;
  final DateTime? verifiedAt;
  final String? failureReason;

  factory KycStatusSnapshot.fromJson(Map<String, dynamic> json) =>
      KycStatusSnapshot(
        status: KycStatus.fromApi(json['status'] as String?),
        startedAt: DateTime.tryParse(json['startedAt'] as String? ?? ''),
        verifiedAt: DateTime.tryParse(json['verifiedAt'] as String? ?? ''),
        failureReason: json['failureReason'] as String?,
      );
}
