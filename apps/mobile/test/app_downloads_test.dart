import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/widgets/app_downloads_panel.dart';

void main() {
  for (final width in [360.0, 1440.0]) {
    testWidgets('download reports at $width show coverage and grouping without overflow', (tester) async {
      tester.view.physicalSize = Size(width, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final calls = <RequestOptions>[];
      final dio = Dio()..interceptors.add(InterceptorsWrapper(onRequest: (r, h) {
        calls.add(r);
        final period = {'count': 5, 'reportedDays': 1, 'expectedDays': 7};
        final absent = {'count': null, 'reportedDays': 0, 'expectedDays': 7};
        h.resolve(Response(requestOptions: r, data: {
          'domain': 'FLUPFLAP', 'year': 2026, 'asOf': '2026-10-18', 'iosConfigured': false,
          'platforms': [for (final platform in ['ANDROID', 'IOS']) {
            'platform': platform, 'source': '$platform store report', 'lastReportDate': null, 'lastImportedAt': null,
            for (final key in ['today', 'week', 'month', 'year']) key: platform == 'ANDROID' ? period : absent,
          }],
          'series': [{'date': '2026-10', 'android': 5, 'ios': null, 'reportedDays': {'android': 1, 'ios': 0}, 'expectedDays': 18}],
        }));
      }));
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: AppDownloadsPanel(dio: dio)))));
      await tester.pumpAndSettle();
      expect(find.text('Android'), findsWidgets);
      expect(find.text('iOS'), findsWidgets);
      expect(find.text('5 *'), findsWidgets);
      expect(find.text('—'), findsWidgets);
      expect(find.text('Import report'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Weekly'));
      await tester.tap(find.text('Weekly'));
      await tester.pumpAndSettle();
      expect(calls.last.queryParameters['groupBy'], 'week');
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('report import sends contents and platform then refreshes', (tester) async {
    final calls = <RequestOptions>[];
    final dio = Dio()..interceptors.add(InterceptorsWrapper(onRequest: (r, h) {
      calls.add(r);
      h.resolve(Response(requestOptions: r, data: r.method == 'POST' ? {'importedDays': 1} : {
        'domain': 'FLUPFLAP', 'year': 2026, 'asOf': '2026-10-18', 'platforms': <dynamic>[], 'series': <dynamic>[], 'iosConfigured': false,
      }));
    }));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: AppDownloadsPanel(dio: dio, canImport: true)))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Import report'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Date,Package Name,Daily User Installs\n2026-10-17,com.ticash.flupflap,3');
    await tester.tap(find.widgetWithText(FilledButton, 'Import report'));
    await tester.pumpAndSettle();
    expect(calls.where((r) => r.method == 'POST').single.data['platform'], 'ANDROID');
    expect(calls.last.method, 'GET');
    expect(tester.takeException(), isNull);
  });
}
