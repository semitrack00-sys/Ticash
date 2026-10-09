import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/recharge_plan_card.dart';
import 'package:ticash/models/mobile_top_up.dart';
import 'parity_widget_test.dart' show shell, press;

MobileTopUpProduct plan(String name, {String id = 'bundle', double price = 5}) => MobileTopUpProduct(
  id: id, operatorId: 172, kind: MobileTopUpKind.bundle, name: name,
  price: price, priceCurrency: 'USD', deliveredCurrency: 'HTG', amountType: 'FIXED',
);
const providerName = '7GB of Data - Unlimited Digi to Digi Calls - Valid for 7 days';

void main() {
  setUpAll(() async {
    final font = Platform.environment['FLUPFLAP_TEST_FONT'];
    if (font != null) {
      await (FontLoader('Roboto')..addFont(Future.value(ByteData.sublistView(File(font).readAsBytesSync())))).load();
      final icons = File('${File(font).parent.path}/materialicons-regular.otf');
      await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
    }
  });
  test('display summaries preserve bonus quantities and do not invent validity', () {
    expect(planSummary(plan(providerName), 'Bundle'), '7 GB');
    expect(planValidity(plan(providerName)), '7 days');
    expect(planValidity(plan('2GB Data + 2GB Bonus Data, 7DAYS')), '7 days');
    expect(planSummary(plan('2GB Data + 2GB Bonus Data, 7DAYS'), 'Bundle'), '2 GB + 2 GB Bonus');
    expect(planSummary(plan('4GB + 4GB Bonus Data, Unlimited calls'), 'Bundle'), '4 GB + 4 GB Bonus');
    expect(planSummary(plan('Unlimited WhatsApp and unlimited calls, data allowance unknown'), 'Bundle'), 'Bundle');
    expect(planValidity(plan('Unnamed provider offer')), isNull);
  });
  testWidgets('card details retain complete provider terms and select the original product once', (t) async {
    final product = plan(providerName);
    var selections = 0;
    await t.pumpWidget(shell(Scaffold(body: Padding(
      padding: const EdgeInsets.all(20),
      child: RechargePlanCard(product: product, selected: false,
        detailLabel: (value) => value, onSelected: () => selections++),
    ))));
    expect(find.text('7 GB'), findsOneWidget);
    expect(find.text(r'$5.00'), findsOneWidget);
    expect(find.text('7 days'), findsOneWidget);
    await press(t, find.text('Plan details'));
    expect(selections, 0);
    final fullText = find.text(providerName).last;
    expect(fullText, findsOneWidget);
    expect(t.widget<Text>(fullText).maxLines, isNull);
    await press(t, find.text('Select plan'));
    expect(selections, 1);
    expect(find.text('Select plan'), findsNothing);
    expect(t.takeException(), isNull);
  });
  for (final width in [320.0, 390.0]) {
    for (final scale in [1.0, 1.5]) {
      testWidgets('plan cards fit width=$width scale=$scale', (t) async {
        t.view.devicePixelRatio = 1;
        t.view.physicalSize = Size(width, 900);
        t.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(t.view.resetDevicePixelRatio);
        addTearDown(t.view.resetPhysicalSize);
        addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
        final products = [
          plan(providerName),
          plan('Unlimited Talk to 1 USA/CAD or France Fixed-line phone - Unlimited On-Net calls - Unlimited WhatsApp - 2GB Data + 2GB Bonus Data, 7DAYS', id: 'second', price: 7),
          plan('4GB + 4GB Bonus Data, Unlimited Talk to 1 USA/CAD or France Fixed-line phone, Unlimited Digi to Digi Calls, Unlimited WhatsApp, Valid for 7 days', id: 'third', price: 10),
        ];
        await t.pumpWidget(shell(Scaffold(
          appBar: AppBar(title: const Text('Choose your plan')),
          body: ListView(padding: const EdgeInsets.all(20), children: [
            const Text('Digicel Haiti Bundles', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 16),
            for (final product in products)
              Padding(padding: const EdgeInsets.only(bottom: 12), child: RechargePlanCard(
                product: product, selected: product.id == 'bundle', detailLabel: (value) => value, onSelected: () {},
              )),
          ]),
        )));
        await t.pumpAndSettle();
        expect(t.takeException(), isNull);
        for (final product in products) {
          final button = find.byKey(ValueKey('plan-${product.id}'));
          await t.ensureVisible(button);
          await t.pumpAndSettle();
          final rect = t.getRect(button);
          expect(rect.left, greaterThanOrEqualTo(0));
          expect(rect.right, lessThanOrEqualTo(width));
          final style = t.widget<OutlinedButton>(button).style!;
          expect((style.shape!.resolve({}) as RoundedRectangleBorder).borderRadius, BorderRadius.circular(16));
        }
        if (width == 390 && scale == 1) {
          final dir = Platform.environment['FLUPFLAP_SCREENSHOT_DIR'];
          if (dir != null) {
            await t.ensureVisible(find.byKey(const ValueKey('plan-bundle')));
            await t.pumpAndSettle();
            final boundary = t.allRenderObjects.whereType<RenderRepaintBoundary>().firstWhere((r) => r.size == t.view.physicalSize);
            await t.runAsync(() async {
              final image = await boundary.toImage();
              final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
              await Directory(dir).create(recursive: true);
              await File('$dir/plan-cards-390.png').writeAsBytes(bytes!.buffer.asUint8List());
              image.dispose();
            });
          }
        }
      });
    }
  }
}
