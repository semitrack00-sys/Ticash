import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../localization/app_localizations.dart';
import '../services/storage_service.dart';

final languageProvider = StateNotifierProvider<LanguageController, AppLanguage>(
  (ref) {
    return LanguageController(StorageService.instance);
  },
);

class LanguageController extends StateNotifier<AppLanguage> {
  LanguageController(this._storage) : super(AppLanguage.english) {
    _restore();
  }

  final StorageService _storage;

  Future<void> _restore() async {
    final savedCode = await _storage.languageCode;
    if (!mounted) return;
    state = AppLanguage.fromCode(savedCode);
  }

  Future<void> select(AppLanguage language) async {
    if (state == language) return;
    state = language;
    await _storage.saveLanguageCode(language.code);
  }
}
