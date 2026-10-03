import 'dart:io';
import 'package:flupflap/phone_country_field.dart';
import 'package:flupflap/country_flag.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/localization/app_localizations.dart';

Widget phoneShell({required Widget home}) => AppLocalizationScope(
  language: AppLanguage.english,
  child: MaterialApp(home: home),
);

void main() {
  for (final sample in [
    ('HT', '37 00 00 00', '+50937000000'),
    ('US', '(202) 555-0123', '+12025550123'),
    ('DO', '809 555 1234', '+18095551234'),
    ('DO', '829 555 1234', '+18295551234'),
    ('DO', '849 555 1234', '+18495551234'),
    ('FR', '06 12 34 56 78', '+33612345678'),
    ('BR', '(11) 98765-4321', '+5511987654321'),
    ('GB', '07400 123456', '+447400123456'),
  ]) {
    test('${sample.$1} national digits normalize to E.164', () {
      final entry = PhoneEntry.parse(sample.$2, PhoneCountry.find(sample.$1)!);
      expect(entry.requireE164(), sample.$3);
      expect(entry.country.code, sample.$1);
      expect(entry.number!.isValid(), isTrue);
    });
    test('${sample.$3} already international never gets a second prefix', () {
      final entry = PhoneEntry.parse(sample.$3, PhoneCountry.find('HT')!);
      expect(entry.requireE164(), sample.$3);
    });
  }

  for (final sample in [
    ('HT', '+5093700000'),
    ('HT', '+509370000000'),
    ('US', '+1202555012'),
    ('US', '+120255501234'),
  ]) {
    test('${sample.$2} is E.164-shaped but has an invalid national length', () {
      final entry = PhoneEntry.parse(sample.$2, PhoneCountry.find(sample.$1)!);
      expect(entry.number, isNotNull);
      expect(entry.e164, sample.$2);
      expect(entry.e164, matches(r'^\+[1-9][0-9]{6,14}$'));
      expect(entry.number!.isValidLength(), isFalse);
      expect(
        entry.requireE164,
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            'Invalid phone number',
          ),
        ),
      );
    });
  }

  test('requireE164 rejects an absent parsed number', () {
    final entry = PhoneEntry(PhoneCountry.find('HT')!, null);
    expect(entry.requireE164, throwsFormatException);
  });

  test('full maintained list has names, ISO codes and calling codes', () {
    expect(PhoneCountry.all.length, greaterThan(240));
    expect(
      PhoneCountry.all.map((c) => c.code).toSet().length,
      PhoneCountry.all.length,
    );
    for (final country in PhoneCountry.all) {
      expect(country.name.length, greaterThan(2), reason: country.code);
      expect(country.code, matches(r'^[A-Z]{2}$'));
      expect(country.callingCode, matches(r'^[1-9][0-9]{0,2}$'));
      expect(
        File(
          'assets/flags/${CountryFlag.assetCode(country.code)}.svg',
        ).existsSync(),
        isTrue,
        reason: country.code,
      );
    }
    for (final code in ['US', 'DO', 'CA', 'JM', 'BB', 'TT', 'PR']) {
      expect(PhoneCountry.find(code)!.callingCode, '1');
    }
  });

  test('search matches country names, ISO and calling codes', () {
    expect(PhoneCountry.search('hait').single.code, 'HT');
    expect(PhoneCountry.search('fr').any((c) => c.code == 'FR'), isTrue);
    expect(PhoneCountry.search(' +509 ').single.code, 'HT');
    expect(
      PhoneCountry.search('+1').map((c) => c.code),
      containsAll(['US', 'DO', 'CA']),
    );
    expect(PhoneCountry.search('no such country'), isEmpty);
  });

  test(
    'locale uses region, tries subsequent locales and has an editable fallback',
    () {
      expect(PhoneCountry.fromLocales([const Locale('fr', 'HT')]).code, 'HT');
      expect(PhoneCountry.fromLocales([const Locale('en', 'DO')]).code, 'DO');
      expect(
        PhoneCountry.fromLocales([
          const Locale('fr'),
          const Locale('pt', 'BR'),
        ]).code,
        'BR',
      );
      expect(PhoneCountry.fromLocales([const Locale('en', 'ZZ')]).code, 'US');
      expect(PhoneCountry.fromLocales([]).code, 'US');
    },
  );

  test(
    'NANP area codes override a default US selection without losing digits',
    () {
      for (final input in ['8095551234', '+18095551234']) {
        final entry = PhoneEntry.parse(input, PhoneCountry.find('US')!);
        expect(entry.country.code, 'DO');
        expect(entry.e164, '+18095551234');
      }
      expect(
        PhoneEntry.parse('+1', PhoneCountry.find('DO')!).country.code,
        'DO',
      );
      expect(
        PhoneEntry.parse('+14165550123', PhoneCountry.find('US')!).country.code,
        'CA',
      );
    },
  );

  test('international 00 prefix is independent of the selected country', () {
    final entry = PhoneEntry.parse('0033612345678', PhoneCountry.find('HT')!);
    expect(entry.country.code, 'FR');
    expect(entry.requireE164(), '+33612345678');
  });

  test('malformed or incomplete input cannot be submitted', () {
    for (final input in [
      '',
      '+',
      '++50937000000',
      '509+37000000',
      '123',
      '+99912345678',
      '+50937000000 ext 2',
    ]) {
      expect(
        () => PhoneEntry.parse(input, PhoneCountry.find('HT')!).requireE164(),
        throwsFormatException,
        reason: input,
      );
    }
  });

  Future<void> choose(WidgetTester t, String query, String code) async {
    await t.tap(find.byKey(const ValueKey('phone-country-picker')));
    await t.pumpAndSettle();
    await t.enterText(
      find.byKey(const ValueKey('phone-country-search')),
      query,
    );
    await t.pumpAndSettle();
    await t.tap(find.byKey(ValueKey('phone-country-$code')));
    await t.pumpAndSettle();
  }

  testWidgets('picker uses device region and sends national input as E.164', (
    t,
  ) async {
    t.platformDispatcher.localesTestValue = [const Locale('fr', 'HT')];
    addTearDown(t.platformDispatcher.clearLocalesTestValue);
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    PhoneEntry? latest;
    await t.pumpWidget(
      phoneShell(
        home: Scaffold(
          body: PhoneCountryField(
            controller: controller,
            onChanged: (entry) => latest = entry,
          ),
        ),
      ),
    );
    expect(find.text('+509'), findsOneWidget);
    await t.enterText(find.byType(TextField), '37000000');
    expect(latest!.requireE164(), '+50937000000');
    await choose(t, 'Dominican', 'DO');
    await t.enterText(find.byType(TextField), '8095551234');
    await t.pump();
    expect(find.text('+1'), findsOneWidget);
    expect(latest!.country.code, 'DO');
    expect(latest!.requireE164(), '+18095551234');
    await t.enterText(find.byType(TextField), '+33 6 12 34 56 78');
    await t.pump();
    expect(find.text('+33'), findsOneWidget);
    expect(latest!.requireE164(), '+33612345678');
    expect(controller.text, '612345678');
    await t.enterText(find.byType(TextField), '0050937000000');
    await t.pump();
    expect(latest!.requireE164(), '+50937000000');
    expect(controller.text, '37000000');
  });

  testWidgets(
    'switching country replaces an explicit prefix and preserves national digits',
    (t) async {
      final controller = TextEditingController(text: '+50937000000');
      addTearDown(controller.dispose);
      PhoneEntry? latest;
      await t.pumpWidget(
        phoneShell(
          home: Scaffold(
            body: PhoneCountryField(
              controller: controller,
              countryCode: 'HT',
              onChanged: (entry) => latest = entry,
            ),
          ),
        ),
      );
      await choose(t, '+33', 'FR');
      expect(controller.text, '37000000');
      expect(latest!.e164, '+3337000000');
      await t.enterText(find.byType(TextField), '612345678');
      await choose(t, 'HT', 'HT');
      expect(controller.text, '612345678');
      expect(latest!.e164, '+509612345678');
    },
  );

  testWidgets('disabled field cannot change destination', (t) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await t.pumpWidget(
      phoneShell(
        home: Scaffold(
          body: PhoneCountryField(
            controller: controller,
            enabled: false,
            onChanged: (_) => fail('Must stay locked'),
          ),
        ),
      ),
    );
    expect(
      t.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
      isNull,
    );
    expect(t.widget<TextField>(find.byType(TextField)).enabled, isFalse);
  });

  testWidgets(
    'saved E.164 and programmatic recipient updates show one prefix without emitting edits',
    (t) async {
      final controller = TextEditingController(text: '+50937000000');
      addTearDown(controller.dispose);
      Widget form(String code) => phoneShell(
        home: Scaffold(
          body: PhoneCountryField(
            controller: controller,
            countryCode: code,
            onChanged: (_) =>
                fail('Prefill must retain the journey and recipient ID'),
          ),
        ),
      );
      await t.pumpWidget(form('HT'));
      expect(controller.text, '37000000');
      expect(find.text('+509'), findsOneWidget);
      controller.text = '+18095551234';
      await t.pumpWidget(form('DO'));
      expect(controller.text, '8095551234');
      expect(find.text('+1'), findsOneWidget);
      controller.text = '+18295551234';
      await t.pumpAndSettle();
      expect(controller.text, '8295551234');
    },
  );
}
