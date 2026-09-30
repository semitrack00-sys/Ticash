import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/services/admin_analytics_service.dart';
import 'package:ticash/services/admin_service.dart';
import 'package:ticash/screens/admin/flupflap_admin_page.dart';
import 'package:ticash/widgets/admin_analytics_panel.dart';
import 'admin_analytics_fixture.dart';

void main() {
  test(
    'cent formatting is exact, including large amounts and absent averages',
    () {
      expect(analyticsMoney('12345678901234567'), r'$123,456,789,012,345.67');
      expect(analyticsMoney('125'), r'$1.25');
      expect(analyticsMoney('0'), r'$0.00');
      expect(analyticsMoney(null), '—');
    },
  );
  for (final business in AnalyticsBusiness.values) {
    for (final width in [360.0, 390.0, 768.0, 1440.0]) {
      testWidgets(
        '${business.name} analytics at $width has no clipped layout',
        (tester) async {
          tester.view.physicalSize = Size(width, 1100);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final adapter = AnalyticsFixtureAdapter();
          final dio = Dio(BaseOptions(baseUrl: 'https://fixture.example.test'))
            ..httpClientAdapter = adapter;
          await tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: AdminAnalyticsPanel(business: business, dio: dio),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(find.text('Total clients'), findsOneWidget);
          expect(find.text('Sales performance'), findsOneWidget);
          expect(find.text('Subscription analytics'), findsOneWidget);
          expect(
            adapter.requests.single.path,
            business == AnalyticsBusiness.ticash
                ? '/admin/analytics'
                : '/admin/flupflap/analytics',
          );
          expect(tester.takeException(), isNull);
          await tester.tap(find.text('Today'));
          await tester.pumpAndSettle();
          expect(adapter.requests.last.queryParameters, {
            'period': 'today',
            'mode': 'live',
          });
          expect(find.text(r'$12.00'), findsWidgets);
          expect(
            find.text(
              business == AnalyticsBusiness.ticash
                  ? r'$15,340.00'
                  : r'$1,482.75',
            ),
            findsNothing,
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
  testWidgets(
    'periods and mode update the full analytics request; cancel custom preserves state',
    (tester) async {
      final adapter = AnalyticsFixtureAdapter();
      final dio = Dio(BaseOptions(baseUrl: 'https://fixture.example.test'))
        ..httpClientAdapter = adapter;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: AdminAnalyticsPanel(
                business: AnalyticsBusiness.flupflap,
                dio: dio,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      for (final item in [
        ('7 Days', '7d'),
        ('This Year', 'year'),
        ('30 Days', '30d'),
      ]) {
        await tester.tap(find.text(item.$1));
        await tester.pumpAndSettle();
        expect(adapter.requests.last.queryParameters['period'], item.$2);
      }
      await tester.tap(find.text('Live records'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Test records').last);
      await tester.pumpAndSettle();
      expect(adapter.requests.last.queryParameters['mode'], 'test');
      expect(find.text('Simulated fees'), findsOneWidget);
      final count = adapter.requests.length;
      await tester.tap(find.text('Custom'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(adapter.requests.length, count);
    },
  );
  testWidgets(
    'API error hides numbers; retry recovers; wrong business fails closed',
    (tester) async {
      final adapter = AnalyticsFixtureAdapter()..unavailable = true;
      final dio = Dio(BaseOptions(baseUrl: 'https://fixture.example.test'))
        ..httpClientAdapter = adapter;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: AdminAnalyticsPanel(
                business: AnalyticsBusiness.ticash,
                dio: dio,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Analytics unavailable'), findsOneWidget);
      expect(find.text('Total clients'), findsNothing);
      adapter.unavailable = false;
      await tester.tap(find.text('Retry analytics'));
      await tester.pumpAndSettle();
      expect(find.text('Total clients'), findsOneWidget);
      adapter.wrongDomain = 'FLUPFLAP';
      await tester.tap(find.byTooltip('Refresh analytics'));
      await tester.pumpAndSettle();
      expect(find.text('Analytics unavailable'), findsOneWidget);
    },
  );
  testWidgets(
    'FlupFlap dashboard embeds shared analytics for report-authorized staff only',
    (tester) async {
      final adapter = AnalyticsFixtureAdapter();
      final dio = Dio(BaseOptions(baseUrl: 'https://fixture.example.test'))
        ..httpClientAdapter = adapter;
      Future<void> render(Set<String> permissions) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: FlupFlapAdminPage(
                key: UniqueKey(),
                dio: dio,
                session: AdminSession(
                  role: 'READ_ONLY',
                  permissions: permissions,
                  environment: 'SANDBOX',
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
      }

      await render({'recharge.view'});
      expect(
        adapter.requests.where((r) => r.path.endsWith('/analytics')),
        isEmpty,
      );
      await render({'recharge.view', 'recharge.reports'});
      expect(
        adapter.requests.where((r) => r.path.endsWith('/analytics')),
        hasLength(1),
      );
      expect(find.text('FlupFlap business analytics'), findsOneWidget);
    },
  );
}
