import 'package:dio/dio.dart';
import 'package:dio_web_adapter/dio_web_adapter.dart';

void configureBrowserTransport(Dio dio) {
  // Existing backend HttpOnly-cookie refresh keeps browser sessions across reloads.
  dio.httpClientAdapter = BrowserHttpClientAdapter(withCredentials: true);
}
