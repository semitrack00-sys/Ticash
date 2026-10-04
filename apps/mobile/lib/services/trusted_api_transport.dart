import 'package:dio/dio.dart';

/// Check the destination before attaching access tokens or sending credentials.
bool isTrustedApiRequest(
  RequestOptions request,
  String configuredBaseUrl, {
  bool allowLocalHttp = false,
}) {
  final base = Uri.tryParse(configuredBaseUrl);
  if (base == null || base.host.isEmpty || base.userInfo.isNotEmpty ||
      base.hasQuery || base.hasFragment) {
    return false;
  }
  final local = ['localhost', '127.0.0.1', '::1', '10.0.2.2'].contains(base.host);
  if (base.scheme != 'https' &&
      !(allowLocalHttp && local && base.scheme == 'http')) {
    return false;
  }
  Uri destination;
  try {
    destination = request.uri;
  } on FormatException {
    return false;
  }
  final prefix = base.path.replaceFirst(RegExp(r'/+$'), '');
  return destination.scheme == base.scheme &&
      destination.host == base.host && destination.port == base.port &&
      destination.userInfo.isEmpty && !destination.hasFragment &&
      (destination.path == prefix || destination.path.startsWith('$prefix/'));
}
