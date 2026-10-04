import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/services/trusted_api_transport.dart';

void main() {
  const base = 'https://api.example.test/api';
  RequestOptions request(String url) => RequestOptions(baseUrl: url, path: '/users/me');
  test('credentials are confined to the configured scheme, host, port and API path', () {
    expect(isTrustedApiRequest(request(base), base), isTrue);
    for (final url in [
      'https://attacker.example/api', 'http://api.example.test/api',
      'https://api.example.test:444/api', 'https://api.example.test/other',
      'https://user:password@api.example.test/api',
    ]) {
      expect(isTrustedApiRequest(request(url), base), isFalse, reason: url);
    }
    expect(isTrustedApiRequest(RequestOptions(baseUrl: base,
      path: 'https://attacker.example/api/users/me'), base), isFalse);
  });
  test('plaintext is allowed only for explicitly enabled local development', () {
    const local = 'http://localhost:4000/api';
    expect(isTrustedApiRequest(request(local), local), isFalse);
    expect(isTrustedApiRequest(request(local), local, allowLocalHttp: true), isTrue);
    const remote = 'http://api.example.test/api';
    expect(isTrustedApiRequest(request(remote), remote, allowLocalHttp: true), isFalse);
  });
}
