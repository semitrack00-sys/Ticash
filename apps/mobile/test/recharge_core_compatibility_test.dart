import 'package:flutter_test/flutter_test.dart';
import 'package:ticash/models/mobile_top_up.dart' as legacy_models;
import 'package:ticash/providers/mobile_top_up_provider.dart' as legacy_providers;
import 'package:ticash/services/storage_service.dart' as legacy_storage;
import 'package:ticash/localization/app_localizations.dart' as legacy_l10n;
import 'package:ticash_recharge_core/models/mobile_top_up.dart' as core_models;
import 'package:ticash_recharge_core/providers/mobile_top_up_provider.dart'
    as core_providers;
import 'package:ticash_recharge_core/services/storage_service.dart' as core_storage;
import 'package:ticash_recharge_core/localization/app_localizations.dart' as core_l10n;

void main() {
  test('TiCash keeps the same shared recharge model types', () {
    expect(legacy_models.MobileTopUpCountry, same(core_models.MobileTopUpCountry));
    expect(legacy_models.MobileTopUpProduct, same(core_models.MobileTopUpProduct));
  });

  test('TiCash keeps the same recharge provider instance', () {
    expect(legacy_providers.mobileTopUpServiceProvider,
        same(core_providers.mobileTopUpServiceProvider));
  });

  test('TiCash keeps one secure token store', () {
    expect(legacy_storage.StorageService.instance,
        same(core_storage.StorageService.instance));
  });

  test('TiCash keeps the same localization type', () {
    expect(legacy_l10n.AppLanguage, same(core_l10n.AppLanguage));
  });
}
