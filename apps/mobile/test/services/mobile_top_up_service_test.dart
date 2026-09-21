import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/services/mobile_top_up_service.dart';

class _FakeDio extends Dio {
  _FakeDio(this._onGet) : super();

  final Future<Response<dynamic>> Function(
    String path,
    Map<String, dynamic>? queryParameters,
  ) _onGet;

  @override
  Future<Response<T>> get<T>(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    CancelToken? cancelToken,
    ProgressCallback? onReceiveProgress,
  }) async {
    final response = await _onGet(path, queryParameters);
    return Response<T>(
      data: response.data as T,
      requestOptions: response.requestOptions,
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
      isRedirect: response.isRedirect,
      redirects: response.redirects,
      extra: response.extra,
      headers: response.headers,
    );
  }
}

void main() {
  test('loads supported countries from the worldwide recharge endpoint', () async {
    String? requestedPath;
    final service = MobileTopUpService(
      dio: _FakeDio((path, queryParameters) async {
        requestedPath = path;
        expect(queryParameters, isNull);
        return Response<dynamic>(
          data: {
            'countries': [
              {'code': 'jm', 'name': 'Jamaica'},
              {'code': 'HT', 'name': 'Haiti'},
            ],
          },
          requestOptions: RequestOptions(path: path),
        );
      }),
    );

    final countries = await service.countries();

    expect(requestedPath, '/mobile-topups/countries');
    expect(countries.map((item) => item.code), ['JM', 'HT']);
    expect(countries.map((item) => item.name), ['Jamaica', 'Haiti']);
  });

  test('rejects malformed country codes before sending recharge requests', () async {
    final service = MobileTopUpService(
      dio: _FakeDio((path, queryParameters) async {
        fail('The network layer should not be called for invalid countries.');
      }),
    );

    await expectLater(
      service.operators(''),
      throwsA(isA<ArgumentError>()),
    );
  });
}
