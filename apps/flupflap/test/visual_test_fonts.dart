import 'dart:io';
import 'package:flutter/services.dart';

Future<void> loadVisualTestFonts() async {
  final font = Platform.environment['FLUPFLAP_TEST_FONT'];
  if (font == null) return;
  for (final entry in [
    ('Roboto', font),
    ('MaterialIcons', '${File(font).parent.path}/materialicons-regular.otf'),
  ]) {
    await (FontLoader(entry.$1)..addFont(
          Future.value(ByteData.sublistView(File(entry.$2).readAsBytesSync())),
        ))
        .load();
  }
}
