/// Central place for API-related configuration.
///
/// Values are sourced from compile-time environment variables so that
/// different builds (development/staging/production) can point at
/// different backends without code changes.
class ApiConfig {
  ApiConfig._();

  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:4000/api',
  );

  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 15);

  static const String authLogin = '/auth/login';
  static const String authRegister = '/auth/register';
  static const String authRefresh = '/auth/refresh';
  static const String authLogout = '/auth/logout';

  static const String users = '/users';
  static const String transfers = '/transfers';
  static const String recipients = '/recipients';
  static const String kyc = '/kyc';
}
