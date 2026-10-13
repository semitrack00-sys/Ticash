import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/privacy_actions.dart';
import 'package:flupflap/session.dart';
import 'flupflap_test.dart' show FixtureAdapter, MemoryStorage;
import 'privacy_actions_test.dart' show privacyShell;

class DeletionAdapter extends FixtureAdapter {
  String deletionStatus = 'LOCAL_DATA_DELETED';
  bool wrongPassword = false;
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? stream,
      Future<void>? cancel) async {
    if (options.path.endsWith('/account-deletion')) {
      requests.add(options);
      return ResponseBody.fromString(jsonEncode(wrongPassword
          ? {'code': 'DELETION_PASSWORD_INVALID'}
          : {'requestId': 'disposable-request', 'status': deletionStatus}),
        wrongPassword ? 403 : 200,
        headers: {Headers.contentTypeHeader: ['application/json']});
    }
    return super.fetch(options, stream, cancel);
  }
}

Future<(FlupFlapSession, DeletionAdapter, MemoryStorage)> fixture() async {
  final adapter = DeletionAdapter();
  final storage = MemoryStorage();
  final dio = Dio(BaseOptions(baseUrl: 'https://example.test/api'));
  dio.httpClientAdapter = adapter;
  final session = FlupFlapSession(dio: dio, storage: storage);
  await session.login('flup@example.test', 'Disposable-password');
  return (session, adapter, storage);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('signed-in deletion requires password and explicit confirmation without opening email', (tester) async {
    final (session, adapter, storage) = (await tester.runAsync(fixture))!;
    await tester.pumpWidget(privacyShell(Scaffold(body: PrivacyActions(session: session))));
    await tester.tap(find.text('Delete my account'));
    await tester.pumpAndSettle();
    expect(find.text('Write deletion request'), findsNothing);
    final button = find.byKey(const ValueKey('delete-account-submit'));
    expect(tester.widget<FilledButton>(button).onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('deletion-password')), 'Disposable-password');
    await tester.tap(find.byKey(const ValueKey('deletion-confirmation')));
    await tester.pump();
    await tester.ensureVisible(button);
    await tester.runAsync(() async {
      await tester.tap(button);
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pumpAndSettle();
    final sent = adapter.requests.where((r) => r.path.endsWith('/account-deletion')).single;
    expect(sent.data, {'password': 'Disposable-password', 'confirm': 'DELETE_ACCOUNT'});
    expect(session.authenticated, isFalse);
    expect(storage.value, isNull);
    expect(session.deletionNotice, contains('have been deleted'));
    session.dispose();
  });

  test('pending deletion clears access and clearly reports pending settlement', () async {
    final (session, adapter, storage) = await fixture();
    adapter.deletionStatus = 'DELETION_PENDING';
    expect(await session.deleteAccount('Disposable-password'), 'DELETION_PENDING');
    expect(session.authenticated, isFalse);
    expect(storage.value, isNull);
    expect(session.deletionNotice, contains('pending payment work'));
    session.dispose();
  });

  test('wrong password and invalid response preserve the account session', () async {
    final (session, adapter, storage) = await fixture();
    adapter.wrongPassword = true;
    await expectLater(session.deleteAccount('Incorrect-password'), throwsA(isA<DioException>()));
    expect(session.authenticated, isTrue);
    expect(storage.value, isNotNull);
    adapter.wrongPassword = false;
    adapter.deletionStatus = 'UNKNOWN';
    await expectLater(session.deleteAccount('Disposable-password'), throwsFormatException);
    expect(session.authenticated, isTrue);
    session.dispose();
  });

  test('a session switch during refresh never deletes the newly signed-in account', () async {
    final (session, adapter, _) = await fixture();
    adapter.holdRefresh = Completer<void>();
    final deleting = session.deleteAccount('Disposable-password');
    final assertion = expectLater(deleting, throwsStateError);
    await adapter.refreshStarted.future;
    await session.login('other@example.test', 'Other-test-password');
    adapter.holdRefresh!.complete();
    await assertion;
    expect(adapter.requests.where((r) => r.path.endsWith('/account-deletion')), isEmpty);
    expect(session.authenticated, isTrue);
    session.dispose();
  });
}
