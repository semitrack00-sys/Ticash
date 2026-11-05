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
  testWidgets('edit profile pre-fills saved fields and only saves valid input', (tester) async {
    List<String>? saved;
    await tester.pumpWidget(privacyShell(Scaffold(body: CustomerProfileDetails(
      user: const {'firstName':'Dukens','lastName':'Bal','phone':'+17755550123'},
      onSave: (first,last,phone) async { saved = [first,last,phone]; },
    ))));
    await tester.tap(find.text('Edit profile'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextFormField,'Dukens'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextFormField,'Phone number'), 'invalid');
    await tester.tap(find.text('Save profile'));
    await tester.pumpAndSettle();
    expect(saved, isNull);
    await tester.enterText(find.widgetWithText(TextFormField,'Phone number'), '+50937050210');
    await tester.tap(find.text('Save profile'));
    await tester.pumpAndSettle();
    expect(saved, ['Dukens','Bal','+50937050210']);
    expect(find.text('Profile updated'), findsOneWidget);
  });
  testWidgets('failed save keeps edits visible and cancel never saves', (tester) async {
    var calls = 0;
    await tester.pumpWidget(privacyShell(Scaffold(body: CustomerProfileDetails(
      user: const {'firstName':'Dukens','lastName':'Bal','phone':'+17755550123'},
      onSave: (_,__,___) async { calls++; throw StateError('offline'); },
    ))));
    await tester.tap(find.text('Edit profile')); await tester.pumpAndSettle();
    await tester.tap(find.text('Save profile')); await tester.pumpAndSettle();
    expect(find.text('Unable to save your profile. Check your connection and try again.'), findsOneWidget);
    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.byType(AlertDialog), findsNothing);
  });

}
