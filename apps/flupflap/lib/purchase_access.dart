/// Server timestamps determine the wait; the device clock only formats local time.
class PurchaseAccessInfo {
  PurchaseAccessInfo._(this.mode, this.serverTime, this.retryAt)
      : elapsed = Stopwatch()..start();
  final String mode;
  final DateTime serverTime;
  final DateTime? retryAt;
  final Stopwatch elapsed;
  DateTime get estimatedNow => serverTime.add(elapsed.elapsed);
  static PurchaseAccessInfo? parse(dynamic value) {
    if (value is! Map) return null;
    final mode = value['mode'];
    if (!const ['TEMPORARY_LIMIT', 'CHANGE_AMOUNT', 'ADMIN_REVIEW'].contains(mode)) return null;
    final server = DateTime.tryParse('${value['serverTime']}');
    final retry = DateTime.tryParse('${value['retryAt']}');
    if (server == null || mode == 'TEMPORARY_LIMIT' && (retry == null || retry.isBefore(server))) return null;
    return PurchaseAccessInfo._(mode as String, server, retry);
  }
}
