import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flupflap/customer_profile.dart';
import 'privacy_actions_test.dart' show privacyShell;

void main() {
  testWidgets('profile displays authenticated name, email and phone at narrow width', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 720));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(privacyShell(const Scaffold(
      body: CustomerProfileDetails(user: {
        'firstName': 'Alexandra',
        'lastName': 'Example',
        'email': 'alexandra.long.address@example.test',
        'phone': '+15555550123',
      }),
    )));
    for (final value in ['Alexandra', 'Example',
      'alexandra.long.address@example.test', '+15555550123']) {
      expect(find.text(value), findsOneWidget);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('missing profile values are explicit without fabricated customer details', (tester) async {
    await tester.pumpWidget(privacyShell(const Scaffold(
      body: CustomerProfileDetails(user: {'firstName': '  ', 'phone': null}),
    )));
    expect(find.text('—'), findsNWidgets(4));
    expect(tester.takeException(), isNull);
  });
}
