import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import '../lib/main.dart' as app;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  Future<void> waitFor(WidgetTester tester, Finder finder) async {
    final deadline = DateTime.now().add(const Duration(seconds: 120));
    while (finder.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
      await tester.pump();
    }
    expect(finder, findsWidgets);
  }
  Future<void> settled(WidgetTester tester) async {
    final deadline = DateTime.now().add(const Duration(seconds: 60));
    do {
      await Future<void>.delayed(const Duration(milliseconds: 300));
      await tester.pump();
      if (find.byType(CircularProgressIndicator).evaluate().isEmpty &&
          find.byType(LinearProgressIndicator).evaluate().isEmpty) {
        await Future<void>.delayed(const Duration(seconds: 2));
        await tester.pump();
        return;
      }
    } while (DateTime.now().isBefore(deadline));
    throw StateError('Live screen did not finish loading; do not publish its capture.');
  }
  Future<void> capture(WidgetTester tester, String name) async {
    await settled(tester);
    final texts = tester.widgetList<Text>(find.byType(Text))
        .map((text) => text.data ?? text.textSpan?.toPlainText() ?? '')
        .join('\n');
    expect(texts, isNot(contains('MOCK')));
    expect(texts, isNot(contains('SANDBOX')));
    expect(texts.toLowerCase(), isNot(contains('temporarily unavailable')));
    await binding.takeScreenshot(name);
  }
  testWidgets('Capture current Android UI using a live, empty guest session',
      (tester) async {
    app.main();
    await waitFor(tester, find.text('Continue as guest'));
    await settled(tester);
    await binding.convertFlutterSurfaceToImage();
    await tester.pump();
    await capture(tester, '01-sign-in');
    await tester.tap(find.text('Continue as guest'));
    await waitFor(tester, find.byType(NavigationBar));
    await capture(tester, '02-home');
    await tester.tap(find.byType(NavigationDestination).at(1));
    await tester.pump();
    await capture(tester, '03-recharge');
    await tester.tap(find.byType(NavigationDestination).at(4));
    await tester.pump();
    await capture(tester, '04-account-privacy');
  }, timeout: const Timeout(Duration(minutes: 8)));
}
