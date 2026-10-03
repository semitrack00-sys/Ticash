import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter_test/flutter_test.dart';

const root = 'android/app/src/main/res';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'dedicated glossy F asset has real transparency and safe margins',
    () async {
      final bytes = File(
        '$root/drawable-nodpi/flupflap_f_glossy.png',
      ).readAsBytesSync();
      final codec = await ui.instantiateImageCodec(bytes);
      final image = (await codec.getNextFrame()).image;
      final pixels = (await image.toByteData())!;
      expect(image.width, greaterThanOrEqualTo(512));
      expect(image.height, image.width);
      var opaque = 0;
      for (var y = 0; y < image.height; y++) {
        for (var x = 0; x < image.width; x++) {
          final alpha = pixels.getUint8((y * image.width + x) * 4 + 3);
          if (alpha > 200) opaque++;
          if (x == 0 ||
              y == 0 ||
              x == image.width - 1 ||
              y == image.height - 1) {
            // Allow sub-1% antialiasing noise from the transparent extraction.
            expect(
              alpha,
              lessThanOrEqualTo(2),
              reason: 'transparent border at $x,$y',
            );
          }
        }
      }
      expect(opaque / (image.width * image.height), inInclusiveRange(.2, .7));
      image.dispose();
      codec.dispose();
    },
  );

  test(
    'legacy splash is white with only dedicated centered F; launcher stays separate',
    () {
      for (final dir in ['drawable', 'drawable-v21']) {
        final xml = File('$root/$dir/launch_background.xml').readAsStringSync();
        expect(xml, contains('@android:color/white'));
        expect(xml, contains('@drawable/flupflap_f_glossy'));
        expect(xml, contains('android:gravity="center"'));
        expect(xml, contains('android:width="160dp"'));
        expect(xml, isNot(contains('flupflap_icon')));
      }
      final manifest = File(
        'android/app/src/main/AndroidManifest.xml',
      ).readAsStringSync();
      expect(manifest, contains('android:icon="@drawable/flupflap_icon"'));
      expect(manifest, contains('android:roundIcon="@drawable/flupflap_icon"'));
      expect(
        File('$root/drawable-nodpi/flupflap_icon_bitmap.png').existsSync(),
        isTrue,
      );
    },
  );

  test(
    'Android 12 day and night themes override launcher fallback with safe F canvas',
    () {
      for (final dir in ['values-v31', 'values-night-v31']) {
        final xml = File('$root/$dir/styles.xml').readAsStringSync();
        expect(
          xml,
          contains(
            'name="android:windowSplashScreenBackground">@android:color/white',
          ),
        );
        expect(
          xml,
          contains(
            'name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon',
          ),
        );
        expect(
          xml,
          contains(
            'name="android:windowSplashScreenIconBackgroundColor">@android:color/transparent',
          ),
        );
        expect(xml, isNot(contains('flupflap_icon')));
      }
      final icon = File('$root/drawable/splash_icon.xml').readAsStringSync();
      expect(icon, contains('@drawable/flupflap_f_glossy'));
      // Android first rasterizes at launcher size. Absolute dp layers overflow
      // that small surface and get clipped before the system enlarges it.
      expect(icon, contains('android:inset="22.2222%"'));
      expect(icon, isNot(contains('android:width=')));
      expect(icon, isNot(contains('<solid')));
      for (final dir in [
        'values',
        'values-night',
        'values-v31',
        'values-night-v31',
      ]) {
        final xml = File('$root/$dir/styles.xml').readAsStringSync();
        // Both LaunchTheme and NormalTheme must draw the requested white bars.
        expect(
          'name="android:windowDrawsSystemBarBackgrounds">true'
              .allMatches(xml)
              .length,
          2,
        );
      }
      for (final dir in ['values', 'values-night']) {
        final xml = File('$root/$dir/styles.xml').readAsStringSync();
        expect(
          xml,
          contains('name="android:windowBackground">@android:color/white'),
        );
      }
    },
  );
}
