import 'package:dio/dio.dart';

import '../models/transfer.dart';
import '../models/user.dart';
import 'api_client.dart';

typedef JsonMap = Map<String, dynamic>;

class AdminSession {
  const AdminSession({
    required this.role,
    required this.permissions,
    required this.environment,
  });
  final String role;
  final Set<String> permissions;
  final String environment;
  bool can(String permission) => permissions.contains(permission);

  factory AdminSession.fromJson(JsonMap json) => AdminSession(
    role: json['role'] as String,
    permissions: (json['permissions'] as List<dynamic>).cast<String>().toSet(),
    environment: json['environment'] as String? ?? 'SANDBOX',
  );
}

class AdminOverview {
  const AdminOverview({
    required this.metrics,
    required this.users,
    required this.accountStates,
    required this.transfers,
    required this.auditLogs,
  });
  final Map<String, num> metrics;
  final List<User> users;
  final Map<String, JsonMap> accountStates;
  final List<Transfer> transfers;
  final List<AdminAuditEvent> auditLogs;

  factory AdminOverview.fromJson(JsonMap json) {
    final rawUsers = (json['users'] as List<dynamic>).cast<JsonMap>();
    return AdminOverview(
      metrics: (json['metrics'] as JsonMap).map(
        (key, value) => MapEntry(key, value as num),
      ),
      users: rawUsers.map(User.fromJson).toList(),
      accountStates: {for (final item in rawUsers) item['id'] as String: item},
      transfers: (json['transfers'] as List<dynamic>)
          .map((item) => Transfer.fromJson(item as JsonMap))
          .toList(),
      auditLogs: (json['auditLogs'] as List<dynamic>? ?? const [])
          .map((item) => AdminAuditEvent.fromJson(item as JsonMap))
          .toList(),
    );
  }
}

class AdminAuditEvent {
  const AdminAuditEvent({
    required this.action,
    required this.entity,
    required this.createdAt,
    this.entityId,
  });
  final String action;
  final String entity;
  final String? entityId;
  final DateTime createdAt;

  factory AdminAuditEvent.fromJson(JsonMap json) => AdminAuditEvent(
    action: json['action'] as String,
    entity: json['entity'] as String,
    entityId: json['entityId'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
  );
}

class AdminWorkspace {
  const AdminWorkspace({
    required this.session,
    required this.overview,
    required this.reviews,
    required this.providers,
    required this.configuration,
    required this.ledger,
    required this.reconciliation,
  });
  final AdminSession session;
  final AdminOverview overview;
  final JsonMap reviews;
  final JsonMap providers;
  final JsonMap configuration;
  final JsonMap ledger;
  final JsonMap reconciliation;
}

class AdminService {
  AdminService({Dio? dio}) : _dio = dio ?? ApiClient.instance.dio;
  final Dio _dio;

  Future<AdminSession> session() async =>
      AdminSession.fromJson((await _dio.get('/admin/session')).data as JsonMap);

  Future<AdminOverview> overview() async => AdminOverview.fromJson(
    (await _dio.get('/admin/overview')).data as JsonMap,
  );

  Future<AdminWorkspace> workspace() async {
    final currentSession = await session();
    final results = await Future.wait<dynamic>([
      overview(),
      currentSession.can('compliance.decide')
          ? _get('/admin/reviews')
          : Future.value(<String, dynamic>{'transfers': [], 'customers': []}),
      currentSession.can('providers.view')
          ? _get('/admin/providers')
          : Future.value(<String, dynamic>{'services': [], 'payouts': []}),
      currentSession.can('configuration.view')
          ? _get('/admin/configuration/fees-limits')
          : Future.value(<String, dynamic>{}),
      currentSession.can('ledger.view')
          ? _get('/admin/ledger')
          : Future.value(<String, dynamic>{'transactions': []}),
      currentSession.can('reconciliation.view')
          ? _get('/admin/reconciliation')
          : Future.value(<String, dynamic>{'runs': []}),
    ]);
    return AdminWorkspace(
      session: currentSession,
      overview: results[0] as AdminOverview,
      reviews: results[1] as JsonMap,
      providers: results[2] as JsonMap,
      configuration: results[3] as JsonMap,
      ledger: results[4] as JsonMap,
      reconciliation: results[5] as JsonMap,
    );
  }

  Future<JsonMap> _get(String path, {JsonMap? query}) async =>
      (await _dio.get(path, queryParameters: query)).data as JsonMap;

  Future<JsonMap> customers({String? query}) => _get(
    '/admin/customers',
    query: {if (query != null && query.trim().isNotEmpty) 'q': query.trim()},
  );

  Future<JsonMap> transfers({String? query}) => _get(
    '/admin/transfers',
    query: {if (query != null && query.trim().isNotEmpty) 'q': query.trim()},
  );

  Future<JsonMap> transferDetails(String id) => _get('/admin/transfers/$id');

  Future<void> setRestrictions(
    String userId, {
    required bool accountLocked,
    required bool fundingRestricted,
    required bool payoutRestricted,
    required String reason,
  }) async {
    await _dio.patch(
      '/admin/users/$userId/restrictions',
      data: {
        'accountLocked': accountLocked,
        'fundingRestricted': fundingRestricted,
        'payoutRestricted': payoutRestricted,
        'reason': reason,
      },
    );
  }

  Future<void> decideCompliance(
    String transferId,
    String status,
    String reason,
  ) async {
    await _dio.patch(
      '/admin/transfers/$transferId/compliance',
      data: {'status': status, 'reason': reason},
    );
  }

  Future<void> updatePayoutState(
    String method,
    String state,
    String reason,
  ) async {
    await _dio.patch(
      '/admin/providers/payouts/$method',
      data: {'state': state, 'reason': reason},
    );
  }

  Future<void> reverseTransfer(
    String transferId,
    String reasonCode,
    String note,
  ) async {
    await _dio.post(
      '/admin/transfers/$transferId/reversal',
      data: {'reasonCode': reasonCode, 'note': note},
    );
  }

  Future<void> runReconciliation() async =>
      _dio.post('/admin/reconciliation/run');

  Future<void> updateFeeLimits(JsonMap values) async =>
      _dio.post('/admin/configuration/fees-limits', data: values);
}
