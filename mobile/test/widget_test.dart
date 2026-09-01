import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash_mobile/main.dart';

void main() {
  testWidgets('Home screen shows greeting, balance and quick actions',
      (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: TicashApp()));

    // Initial user/transactions load is simulated with a short delay.
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Your money, ready when you are.'), findsOneWidget);
    expect(find.textContaining('2,485.60'), findsOneWidget);
    expect(find.text('Send money'), findsWidgets);
    expect(find.text('Add money'), findsOneWidget);
    expect(find.text('My QR'), findsOneWidget);
    expect(find.text('Recent activity'), findsOneWidget);
    expect(find.text('SEND ABROAD'), findsOneWidget);
    expect(find.text('Start a transfer'), findsOneWidget);
  });

  testWidgets('Recent activity lists mock transactions', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: TicashApp()));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('MonCash transfer'), findsWidgets);
    expect(find.text('NatCash transfer'), findsOneWidget);
    expect(find.text('Wallet deposit'), findsWidgets);
  });
}
