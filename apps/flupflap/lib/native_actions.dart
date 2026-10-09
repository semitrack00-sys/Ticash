import 'package:flutter/services.dart';
import 'checkout_contract.dart';
import 'package:flutter/foundation.dart';
import 'web_actions_stub.dart'
    if (dart.library.js_interop) 'web_actions.dart' as browser;

class NativeActions {
  static const channel = MethodChannel('com.ticash.flupflap/customer-actions');
  static Future<void> privacyAction(String action) {
    if (!const {'policy', 'deletionPage', 'deletionEmail'}.contains(action)) {
      throw const FormatException('Invalid privacy action');
    }
    if (kIsWeb) return browser.privacyAction(action);
    return channel.invokeMethod<void>('privacy', action);
  }
  static Future<void> checkout(Uri uri) async {
    if (!HostedSession.safeUrl(uri.toString())) {
      throw const FormatException('Invalid checkout');
    }
    if (kIsWeb) {
      await browser.checkout(uri);
      return;
    }
    await channel.invokeMethod<void>('checkout', uri.toString());
  }

  static Future<void> share(String message, {String target = 'share'}) =>
      kIsWeb ? browser.share(message, target: target) :
      channel.invokeMethod<void>('share', {'text': message, 'target': target});
}
