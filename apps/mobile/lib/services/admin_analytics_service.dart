import 'package:dio/dio.dart';
import 'api_client.dart';

enum AnalyticsBusiness { ticash, flupflap }

class AdminAnalyticsService {
  AdminAnalyticsService({Dio? dio}) : _dio = dio ?? ApiClient.instance.dio;
  final Dio _dio;

  Future<Map<String, dynamic>> load(
    AnalyticsBusiness business, {
    required String period,
    required String mode,
    String? start,
    String? end,
  }) async {
    final path = business == AnalyticsBusiness.ticash
        ? '/admin/analytics'
        : '/admin/flupflap/analytics';
    final response = await _dio.get<Map<String, dynamic>>(
      path,
      queryParameters: {
        'period': period,
        'mode': mode,
        if (start != null) 'start': start,
        if (end != null) 'end': end,
      },
    );
    final data = response.data!;
    if (data['domain'] != business.name.toUpperCase() ||
        data['mode'] != mode ||
        data['currency'] != 'USD' ||
        data['clients'] is! Map ||
        data['transactions'] is! Map ||
        data['trend'] is! List) {
      throw const FormatException('Unexpected analytics response');
    }
    return data;
  }
}

/// Exact integer-cent formatting; never used to calculate customer prices.
String analyticsMoney(dynamic cents) {
  if (cents == null) return '—';
  final value = BigInt.parse(cents.toString());
  final absolute = value.abs();
  final dollars = (absolute ~/ BigInt.from(100)).toString().replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ',',
  );
  final fraction = (absolute % BigInt.from(100)).toString().padLeft(2, '0');
  return '${value.isNegative ? '-' : ''}\$$dollars.$fraction';
}
