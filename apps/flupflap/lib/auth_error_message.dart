import 'package:dio/dio.dart';

/// Only trusted, fixed copy is displayed. Never echo server text, request bodies,
/// email addresses, passwords, tokens, or exception strings into the UI.
String authErrorMessage(Object error) {
  if (error is! DioException) {
    return 'Unable to finish signing in. If you just created an account, try Sign in before registering again.';
  }
  final status = error.response?.statusCode;
  final body = error.response?.data;
  final code = body is Map ? body['code'] : null;
  if (status == 429 || code == 'RATE_LIMITED') {
    return 'Too many attempts. Wait 15 minutes before trying again.';
  }
  if (status != null && status >= 500) {
    return 'Account services are temporarily unavailable. Please try again later.';
  }
  if (code == 'REGISTRATION_UNAVAILABLE') {
    return 'Unable to create an account with these details. Try Sign in or Forgot password, or contact support.';
  }
  if (code == 'INVALID_CREDENTIALS') {
    return 'Unable to sign in. Check your email and password, or use Forgot password.';
  }
  if (code == 'INVALID_RESET_TOKEN') {
    return 'This password reset link is invalid or expired. Request a new link.';
  }
  if (code == 'VALIDATION_ERROR') {
    final details = body is Map ? body['details'] : null;
    final fields = <String>{};
    if (details is List) {
      for (final detail in details) {
        final path = detail is Map ? detail['path'] : null;
        if (path is List && path.length == 1 && path.first is String) {
          fields.add(path.first as String);
        }
      }
    }
    if (fields.contains('password')) {
      return 'Use a password with at least 8 characters. If it is very long, shorten it.';
    }
    if (fields.contains('email')) return 'Enter a valid email address.';
    if (fields.contains('phone')) return 'Check your phone number and selected country.';
    if (fields.contains('firstName') || fields.contains('lastName')) {
      return 'Enter your first and last name, each no longer than 80 characters.';
    }
    return 'Check the required account details and try again.';
  }
  if (error.type == DioExceptionType.connectionTimeout ||
      error.type == DioExceptionType.sendTimeout ||
      error.type == DioExceptionType.receiveTimeout) {
    return 'The request timed out. Check your connection. If you were registering, try Sign in before submitting again.';
  }
  if (error.type == DioExceptionType.connectionError ||
      error.type == DioExceptionType.badCertificate) {
    return 'Unable to connect securely. Check your internet connection and try again.';
  }
  return 'Unable to complete account access. Please contact support if this continues.';
}
