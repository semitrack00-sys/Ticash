import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/internet_bundle_card.dart';
import 'package:ticash/models/mobile_top_up.dart';

MobileTopUpProduct plan(int days, {bool structured = true}) => MobileTopUpProduct(
  id: 'plan-$days', operatorId: 1, kind: MobileTopUpKind.bundle,
  name: 'Provider internet bundle', price: 12.34, priceCurrency: 'USD',
  deliveredCurrency: 'HTG', amountType: 'FIXED',
  benefits: structured ? const ['7 GB data', 'Unlimited MINUTES'] : const [],
  validityLabel: structured ? '$days days' : null,
  description: 'Provider original description: conditional data and calls. '
      'Terms apply; retain every word, including regional restrictions.',
);

void main() {
  for (final width in [360.0, 412.0, 1024.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('catalog cards at $width with text scale $scale', (tester) async {
        tester.view.physicalSize = Size(width, 1600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        String? selected;
        final boundary = GlobalKey();
        await tester.pumpWidget(MaterialApp(home: MediaQuery(
          data: MediaQueryData(size: Size(width, 1600),
              textScaler: TextScaler.linear(scale)),
          child: Scaffold(backgroundColor: Colors.white,
            body: RepaintBoundary(key: boundary, child: ListView(
              padding: const EdgeInsets.all(16), children: [
                for (final days in [7, 15, 30]) InternetBundleCard(
                  product: plan(days), selected: false,
                  onSelected: () => selected = 'plan-$days',
                  detailLabel: (value) => value,
                ),
              ],
            )),
          ),
        )));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.text('\$12.34'), findsWidgets);
        await tester.tap(find.byKey(const ValueKey('bundle-buy-plan-7')));
        expect(selected, 'plan-7');
        await tester.tap(find.text('Provider description').first);
        await tester.pumpAndSettle();
        expect(find.text(plan(7).description!), findsOneWidget);
        expect(tester.takeException(), isNull);
        if (Platform.environment['CAPTURE_BUNDLE_SCREENSHOTS'] == '1') {
          final image = await (boundary.currentContext!.findRenderObject()
              as RenderRepaintBoundary).toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          await tester.runAsync(() async {
            final file = File('build/bundle-screenshots/cards-$width-$scale.png');
            await file.parent.create(recursive: true);
            await file.writeAsBytes(bytes!.buffer.asUint8List());
          });
          image.dispose();
        }
      });
    }
  }
  testWidgets('unstructured description does not invent data or validity', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: InternetBundleCard(
      product: plan(7, structured: false), selected: false,
      onSelected: null, detailLabel: (value) => value,
    ))));
    expect(find.text('7 GB'), findsNothing);
    expect(find.text('7 days'), findsNothing);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    await tester.tap(find.text('Provider description'));
    await tester.pumpAndSettle();
    expect(find.text(plan(7).description!), findsOneWidget);
  });
}
