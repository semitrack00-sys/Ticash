import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/theme.dart';
import '../localization/app_localizations.dart';
import '../providers/language_provider.dart';

class LanguageSelector extends ConsumerWidget {
  const LanguageSelector({super.key, this.compact = true});

  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(languageProvider);
    return PopupMenuButton<AppLanguage>(
      tooltip: context.tr('changeLanguage'),
      initialValue: selected,
      onSelected: ref.read(languageProvider.notifier).select,
      itemBuilder: (context) => AppLanguage.values
          .map(
            (language) => PopupMenuItem(
              value: language,
              child: Row(
                children: [
                  SizedBox(
                    width: 30,
                    child: Text(
                      language.code.toUpperCase(),
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  Expanded(child: Text(language.nativeName)),
                  if (language == selected)
                    const Icon(
                      Icons.check_rounded,
                      color: AppTheme.primary,
                      size: 20,
                    ),
                ],
              ),
            ),
          )
          .toList(),
      child: Semantics(
        button: true,
        label: context.tr('changeLanguage'),
        child: compact
            ? Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.language_rounded),
                    const SizedBox(width: 5),
                    Text(
                      selected.code.toUpperCase(),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const Icon(Icons.arrow_drop_down_rounded),
                  ],
                ),
              )
            : ListTile(
                leading: const Icon(Icons.language_rounded),
                title: Text(context.tr('language')),
                subtitle: Text(selected.nativeName),
                trailing: const Icon(Icons.chevron_right_rounded),
              ),
      ),
    );
  }
}
