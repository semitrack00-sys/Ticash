import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/localization/app_localizations.dart';

void main() {
  testWidgets('all five languages translate the primary sign-in action',
      (tester) async {
    final translations = <AppLanguage, String>{};

    for (final language in AppLanguage.values) {
      await tester.pumpWidget(
        MaterialApp(
          home: AppLocalizationScope(
            language: language,
            child: Builder(
              builder: (context) {
                translations[language] = context.tr('signIn');
                return Text(context.tr('signIn'));
              },
            ),
          ),
        ),
      );
    }

    expect(translations, hasLength(5));
    expect(translations.values.toSet(), hasLength(5));
    expect(translations[AppLanguage.english], 'Sign in');
    expect(translations[AppLanguage.spanish], 'Iniciar sesión');
    expect(translations[AppLanguage.french], 'Se connecter');
    expect(translations[AppLanguage.haitianCreole], 'Konekte');
    expect(translations[AppLanguage.portuguese], 'Entrar');
  });

  testWidgets('interpolated translations replace dynamic values',
      (tester) async {
    String? result;
    await tester.pumpWidget(
      MaterialApp(
        home: AppLocalizationScope(
          language: AppLanguage.haitianCreole,
          child: Builder(
            builder: (context) {
              result = context.tr('hiName', {'name': 'Marie'});
              return Text(result!);
            },
          ),
        ),
      ),
    );

    expect(result, 'Bonjou, Marie');
    expect(find.text('Bonjou, Marie'), findsOneWidget);
  });
}
