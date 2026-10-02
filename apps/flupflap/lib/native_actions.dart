import 'package:flutter/services.dart';
import 'checkout_contract.dart';

class NativeActions {
  static const channel = MethodChannel('com.ticash.flupflap/customer-actions');
  static Future<void> checkout(Uri uri) async {
    if (!HostedSession.safeUrl(uri.toString())) {
      throw const FormatException('Invalid checkout');
    }
    await channel.invokeMethod<void>('checkout', uri.toString());
  }

  static Future<void> share(String message, {String target = 'share'}) =>
      channel.invokeMethod<void>('share', {'text': message, 'target': target});
}
