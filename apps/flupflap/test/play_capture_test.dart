import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/privacy_actions.dart';
import 'premium_ui_test.dart' as fixtures;

// Real Flutter widgets with isolated, fictional fixtures. These captures are
// review drafts; they do not prove live catalog availability or delivery.
void main() {
  setUpAll(() async {
    for (final entry in {
      'Roboto': Platform.environment['FLUPFLAP_CAPTURE_FONT'],
      'MaterialIcons': Platform.environment['FLUPFLAP_CAPTURE_ICONS'],
    }.entries) {
      if (entry.value != null) {
        await (FontLoader(entry.key)..addFont(Future.value(
          ByteData.sublistView(File(entry.value!).readAsBytesSync()),
        ))).load();
      }
    }
  });

  testWidgets('capture app screens at a Play-compatible portrait size', (tester) async {
    final (session, adapter) = await fixtures.app(tester, 360);
    tester.view.physicalSize = const Size(360, 640);
    await tester.pumpAndSettle();

    Future<void> capture(String name) async {
      expect(tester.takeException(), isNull, reason: name);
      final directory = Platform.environment['FLUPFLAP_CAPTURE_DIR'];
      if (directory == null) return;
      final boundary = tester.allRenderObjects
          .whereType<RenderRepaintBoundary>()
          .firstWhere((r) => r.size == const Size(360, 640));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 3);
        expect(image.width, 1080);
        expect(image.height, 1920);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        await Directory(directory).create(recursive: true);
        await File('$directory/$name.png').writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
    }

    await capture('01-home-draft');
    await fixtures.tap(tester, find.widgetWithText(NavigationDestination, 'Recharge'));
    await capture('02-recharge-draft');
    await fixtures.tap(tester, find.widgetWithText(NavigationDestination, 'Recipients'));
    await capture('03-recipients-draft');
    await fixtures.tap(tester, find.text(fixtures.recipient['nickname']!));
    await fixtures.tap(tester, find.text('Continue'));
    await fixtures.tap(tester, find.text(fixtures.terms['productName'] as String));
    await fixtures.tap(tester, find.text('Continue'));
    expect(find.text('6.24 USD'), findsOneWidget);
    await capture('08-purchase-review-draft');
    await fixtures.tap(tester, find.widgetWithText(NavigationDestination, 'History'));
    await capture('04-history-empty-draft');
    await fixtures.tap(tester, find.widgetWithText(NavigationDestination, 'Account'));
    await capture('05-account-draft');
    await fixtures.tap(tester, find.byKey(const ValueKey('account-deletion-request')));
    expect(find.byType(DeletionRequestScreen), findsOneWidget);
    expect(find.text('contact@ticash-app.com'), findsOneWidget);
    await capture('06-deletion-request-draft');
    await tester.pageBack();
    await tester.pumpAndSettle();
    await fixtures.tap(tester, find.text('Sign out'));
    expect(session.authenticated, isFalse);
    expect(find.text('Welcome'), findsOneWidget);
    await capture('07-login-draft');
    expect(adapter.requests.every((r) => r.path.startsWith('/flupflap/')), isTrue);
    expect(adapter.requests.where((r) => r.path.endsWith('/payment-sessions')), isEmpty);
    expect(adapter.requests.where((r) => r.path.endsWith('/transactions') && r.method == 'POST'), isEmpty);
  });
}
