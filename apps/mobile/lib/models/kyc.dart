/// Type of identity document submitted for KYC verification.
enum KycDocumentType {
  passport,
  nationalId,
  driversLicense,
}

/// Status of a submitted KYC verification.
enum KycSubmissionStatus {
  pending,
  approved,
  rejected,
}

/// A KYC (Know Your Customer) verification submission.
class KycSubmission {
  final String id;
  final String userId;
  final KycDocumentType documentType;
  final String documentFrontPath;
  final String? documentBackPath;
  final String selfiePath;
  final KycSubmissionStatus status;
  final DateTime submittedAt;

  const KycSubmission({
    required this.id,
    required this.userId,
    required this.documentType,
    required this.documentFrontPath,
    required this.selfiePath,
    required this.status,
    required this.submittedAt,
    this.documentBackPath,
  });

  factory KycSubmission.fromJson(Map<String, dynamic> json) {
    return KycSubmission(
      id: json['id'] as String,
      userId: json['userId'] as String,
      documentType: KycDocumentType.values.firstWhere(
        (type) => type.name == json['documentType'],
        orElse: () => KycDocumentType.nationalId,
      ),
      documentFrontPath: json['documentFrontPath'] as String,
      documentBackPath: json['documentBackPath'] as String?,
      selfiePath: json['selfiePath'] as String,
      status: KycSubmissionStatus.values.firstWhere(
        (status) => status.name == json['status'],
        orElse: () => KycSubmissionStatus.pending,
      ),
      submittedAt: DateTime.parse(json['submittedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'userId': userId,
      'documentType': documentType.name,
      'documentFrontPath': documentFrontPath,
      'documentBackPath': documentBackPath,
      'selfiePath': selfiePath,
      'status': status.name,
      'submittedAt': submittedAt.toIso8601String(),
    };
  }
}
