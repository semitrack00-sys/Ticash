import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/widgets/flupflap_promotions_panel.dart';

class PromotionFixture implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  bool unavailable = false;
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? request, Future<void>? cancel) async {
    requests.add(options);
    final data = options.path.endsWith('/promoters') ? {'promoters': [{'id':'promoter-test', 'name':'Test promoter'}]}
      : options.path.endsWith('/rewards') ? {'rewards': [{'id':'reward-test', 'amountCents':25, 'testMode':true, 'status':'PAYABLE', 'createdAt':'2026-09-30'}]}
      : {'campaigns':[{'id':'campaign-test', 'name':'Community connections', 'code':'TESTONLY', 'status':'ACTIVE', 'testMode':true,
        'shareUrl':'https://www.flupflap.com/join?promo=TESTONLY', 'startsAt':'2026-09-30', 'endsAt':'2026-10-30',
        'funnel':{'LANDING_VIEWED':10, 'SIGNUP_STARTED':5, 'ACCOUNT_CREATED':2}, 'qualifiedCustomers':1, 'successfulRecharges':1,
        'promotionalCostCents':50, 'attributableFeeCents':129, 'conversionRate':0.1, 'rewards':[],
      }]};
    return ResponseBody.fromString(jsonEncode(data), unavailable ? 503 : 200, headers:{Headers.contentTypeHeader:[Headers.jsonContentType]});
  }
  @override
  void close({bool force=false}) {}
}

void main() {
  Future<PromotionFixture> mount(WidgetTester tester, {bool canManage=false, bool unavailable=false}) async {
    final fixture=PromotionFixture()..unavailable=unavailable;
    final dio=Dio(BaseOptions(baseUrl:'https://fixture.example.test/api'))..httpClientAdapter=fixture;
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:Padding(padding:const EdgeInsets.all(16), child:FlupFlapPromotionsPanel(dio:dio,canManage:canManage))))));
    await tester.pumpAndSettle();return fixture;
  }
  for(final width in [390.0,430.0,768.0,1440.0]) {
    testWidgets('real aggregate cards fit $width without overflow or payout controls', (tester) async {
      tester.view.physicalSize=Size(width,1800);tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
      final fixture=await mount(tester);
      expect(find.text('Landing views: 10'),findsOneWidget);
      expect(find.text('Qualified customers: 1'),findsOneWidget);
      expect(find.text('Create campaign'),findsNothing);
      expect(find.text('Record PAID'),findsNothing);
      expect(fixture.requests.every((r)=>r.method=='GET' && r.path.startsWith('/admin/flupflap/promotions')),isTrue);
      expect(tester.takeException(),isNull);
    });
  }
  testWidgets('unavailable metrics do not become invented zero totals', (tester) async {
    await mount(tester,unavailable:true);
    expect(find.textContaining('Promotions are unavailable'),findsOneWidget);
    expect(find.textContaining('Landing views'),findsNothing);
  });
  testWidgets('authorized campaign editor exposes separate benefits/rewards and audit reason', (tester) async {
    await mount(tester,canManage:true);
    await tester.tap(find.text('Create campaign'));await tester.pumpAndSettle();
    expect(find.text('Campaign name'),findsOneWidget);
    expect(find.textContaining('Monetary benefits and rewards are sandbox-only'),findsOneWidget);
    expect(find.text('Customer benefit'),findsOneWidget);
    expect(find.text('Separate promoter reward'),findsOneWidget);
    expect(find.text('Reason for this administrative change'),findsOneWidget);
    expect(tester.takeException(),isNull);
  });
}
