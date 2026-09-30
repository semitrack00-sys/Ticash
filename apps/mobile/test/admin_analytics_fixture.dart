import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';

// Test/screenshot records only. Production widgets always request the admin API.
Map<String, dynamic> analyticsFixture(
  String domain, {
  String mode = 'live',
  bool today = false,
}) => {
  'domain': domain,
  'mode': mode,
  'currency': 'USD',
  'timezone': 'UTC',
  'start': today ? '2026-09-29T00:00:00Z' : '2026-09-01T00:00:00Z',
  'end': '2026-09-29T12:00:00Z',
  'clients': {
    'total': domain == 'TICASH' ? 64 : 112,
    'new': today ? 1 : 18,
    'active': today ? 2 : 39,
    'guest': 40,
    'registered': 72,
  },
  'transactions': {
    'total': today ? 2 : 84,
    'successful': today ? 1 : 74,
    'pending': 6,
    'failed': 3,
    'reversed': 1,
  },
  'volumeCents': today
      ? '1200'
      : domain == 'TICASH'
      ? '1534000'
      : '148275',
  'feeRevenueCents': today ? '125' : '10475',
  'previousVolumeCents': '85000',
  'unattributedFeeCount': 0,
  'averageCents': '2004',
  'successRate': 88.1,
  'performance': 'HIGH',
  'trend': [
    for (var i = 0; i < (today ? 1 : 29); i++)
      {
        'date': '2026-09-${(i + 1).toString().padLeft(2, '0')}',
        'count': i + 1,
        'volumeCents': '${(i % 4 + 1) * 2500 + i * 190}',
      },
  ],
  'countries': [
    {'name': 'HT', 'count': 48, 'volumeCents': '97500'},
    {'name': 'JM', 'count': 26, 'volumeCents': '50775'},
  ],
  'products': domain == 'TICASH'
      ? [
          {'name': 'REMITTANCE', 'count': 74, 'volumeCents': '1534000'},
        ]
      : [
          {'name': 'AIRTIME', 'count': 50, 'volumeCents': '97500'},
          {'name': 'DATA', 'count': 18, 'volumeCents': '35775'},
          {'name': 'BUNDLE', 'count': 6, 'volumeCents': '15000'},
        ],
  'operators': [
    {
      'name': domain == 'TICASH' ? 'Test payout provider' : 'Test carrier A',
      'count': 48,
      'volumeCents': '97500',
    },
    {'name': 'Test carrier B', 'count': 26, 'volumeCents': '50775'},
  ],
  'recent': [
    {
      'id': 'fixture-transaction',
      'operator': 'Test provider',
      'country': 'HT',
      'product': domain == 'TICASH' ? 'REMITTANCE' : 'AIRTIME',
      'created': '2026-09-29T12:00:00Z',
      'amountCents': '1200',
      'status': 'COMPLETED',
      'outcome': 'SUCCESS',
    },
  ],
  'subscriptions': {'available': false},
  'internetPlans': {'available': false},
};

class AnalyticsFixtureAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  bool unavailable = false;
  String? wrongDomain;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? request,
    Future<void>? cancel,
  ) async {
    requests.add(options);
    final domain =
        wrongDomain ??
        (options.path.contains('/flupflap/') ? 'FLUPFLAP' : 'TICASH');
    final data = options.path.endsWith('/analytics')
        ? analyticsFixture(
            domain,
            mode: options.queryParameters['mode'] as String? ?? 'live',
            today: options.queryParameters['period'] == 'today',
          )
        : {
            'domain': 'FLUPFLAP',
            'environment': 'SANDBOX',
            'enabled': true,
            'productionEnabled': false,
            'approvedForLiveUse': false,
            'liveRechargeEnabled': false,
          };
    return ResponseBody.fromString(
      jsonEncode(data),
      unavailable ? 503 : 200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
