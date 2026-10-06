import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/native_actions.dart';
import 'package:flupflap/privacy_actions.dart';
import 'package:flupflap/privacy_strings.dart';
import 'package:ticash/localization/app_localizations.dart';

Widget privacyShell(Widget home, [AppLanguage language = AppLanguage.english]) =>
    AppLocalizationScope(language: language, child: MaterialApp(home: home));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <MethodCall>[];
  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(NativeActions.channel, (call) async {
      calls.add(call);
      return null;
    });
  });
  tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(NativeActions.channel, null));

  testWidgets('account deletion explains the request and opens email only on tap', (tester) async {
    await tester.pumpWidget(privacyShell(const Scaffold(body: PrivacyActions())));
    await tester.tap(find.text('Delete my account'));
    await tester.pumpAndSettle();
    expect(find.text('Delete my FlupFlap account'), findsOneWidget);
    expect(find.text(deletionSupportEmail), findsOneWidget);
    expect(calls, isEmpty);
    await tester.tap(find.text('Write deletion request'));
    await tester.pumpAndSettle();
    expect(calls.single.method, 'privacy');
    expect(calls.single.arguments, 'deletionEmail');
    await tester.scrollUntilVisible(
      find.text('Open deletion webpage'),
      200,
      scrollable: find.descendant(
        of: find.byType(ListView), matching: find.byType(Scrollable),
      ).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open deletion webpage'));
    await tester.pumpAndSettle();
    expect(calls.last.arguments, 'deletionPage');
  });

  testWidgets('email app failure keeps the address and manual instructions available', (tester) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(NativeActions.channel, (_) async {
      throw PlatformException(code: 'UNAVAILABLE');
    });
    await tester.pumpWidget(privacyShell(const DeletionRequestScreen()));
    await tester.tap(find.text('Write deletion request'));
    await tester.pumpAndSettle();
    expect(find.text(deletionSupportEmail), findsOneWidget);
    expect(find.text('Unable to open. Copy the email address and send your request manually.'), findsOneWidget);
  });

  for (final language in AppLanguage.values) {
    testWidgets('deletion request renders in ${language.code}', (tester) async {
      await tester.pumpWidget(privacyShell(const DeletionRequestScreen(), language));
      expect(find.text(privacyStrings[language.code]!['Delete my FlupFlap account']!), findsOneWidget);
      expect(find.text(deletionSupportEmail), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(calls, isEmpty);
    });
  }

  test('privacy channel rejects arbitrary targets', () {
    expect(() => NativeActions.privacyAction('https://evil.example'), throwsFormatException);
    expect(calls, isEmpty);
  });
}
