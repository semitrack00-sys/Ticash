import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/auth_error_message.dart';

DioException response(int status, dynamic data) {
  final request = RequestOptions(path: '/flupflap/auth/register');
  return DioException(requestOptions: request, type: DioExceptionType.badResponse,
    response: Response(requestOptions: request, statusCode: status, data: data));
}
void main() {
  test('explains rate limits and server failures', () {
    expect(authErrorMessage(response(429, {})), contains('15 minutes'));
    expect(authErrorMessage(response(503, {})), contains('temporarily unavailable'));
  });
  test('registration conflict does not identify an existing email or phone', () {
    final message = authErrorMessage(response(409, {'code': 'REGISTRATION_UNAVAILABLE', 'error': 'secret@example.test'}));
    expect(message, contains('Forgot password'));
    expect(message, isNot(contains('secret@example.test')));
    expect(message, isNot(contains('already exists')));
  });
  for (final field in ['password', 'email', 'phone', 'firstName']) {
    test('explains $field validation without echoing server text', () {
      final message = authErrorMessage(response(400, {'code':'VALIDATION_ERROR', 'details':[{'path':[field], 'message':'private-secret'}]}));
      expect(message, isNot(contains('private-secret')));
      expect(message, isNot(contains('required account details')));
    });
  }
  test('malformed error bodies are handled safely', () {
    for (final body in ['<html>private-secret</html>', null, {'code':'VALIDATION_ERROR','details':[null, {'path':[]}, {'path':'password'}]}]) {
      expect(authErrorMessage(response(400, body)), isNot(contains('private-secret')));
    }
  });
  test('timeout does not invite duplicate registration', () {
    expect(authErrorMessage(DioException(requestOptions: RequestOptions(path:'/register'), type:DioExceptionType.receiveTimeout)), contains('try Sign in'));
  });
  test('local session failure never exposes exception or asserts account creation failed', () {
    expect(authErrorMessage(StateError('private-secret')), contains('try Sign in'));
    expect(authErrorMessage(StateError('private-secret')), isNot(contains('private-secret')));
  });
}
