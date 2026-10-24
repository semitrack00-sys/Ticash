import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/native_actions.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <MethodCall>[];
  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(NativeActions.channel, (call) async { calls.add(call); return null; });
  });
  tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
    .setMockMethodCallHandler(NativeActions.channel, null));
  test('opens the hosted identity session on its own native action', () async {
    await NativeActions.identity(Uri.parse('https://verify.didit.me/en/session/fixture'));
    expect(calls.single.method, 'identity');
  });
  test('rejects unrelated origins and credential-bearing links', () async {
    for (final value in ['http://verify.didit.me/session/x', 'https://verify.didit.me.evil.test/session/x',
      'https://user@verify.didit.me/session/x', 'https://verify.didit.me:444/session/x', 'https://verify.didit.me/']) {
      await expectLater(NativeActions.identity(Uri.parse(value)), throwsFormatException);
    }
    expect(calls, isEmpty);
  });
}
