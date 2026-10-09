import 'dart:js_interop';
import 'package:flutter/services.dart';
import 'package:web/web.dart' as web;

@JS('navigator.share')
external JSFunction? get _shareFunction;

Future<void> checkout(Uri uri) async {
  // NativeActions already validates the exact HTTPS Stripe Checkout origin.
  web.window.location.assign(uri.toString());
}

Future<void> privacyAction(String action) async {
  final url = switch (action) {
    'policy' => 'https://www.flupflap.com/legal/privacy/',
    'deletionPage' => 'https://www.flupflap.com/legal/delete-account/',
    'deletionEmail' => Uri(
      scheme: 'mailto',
      path: 'contact@ticash-app.com',
      queryParameters: {'subject': 'FlupFlap account deletion request'},
    ).toString(),
    _ => throw const FormatException('Invalid privacy action'),
  };
  web.window.location.assign(url);
}

Future<void> share(String message, {String target = 'share'}) async {
  if (target == 'whatsapp') {
    web.window.location.assign(
      Uri.https('wa.me', '/', {'text': message}).toString(),
    );
  } else if (target == 'sms') {
    web.window.location.assign(
      Uri(scheme: 'sms', queryParameters: {'body': message}).toString(),
    );
  } else if (_shareFunction != null) {
    await web.window.navigator.share(web.ShareData(text: message)).toDart;
  } else {
    await Clipboard.setData(ClipboardData(text: message));
  }
}
