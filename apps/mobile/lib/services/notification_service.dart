import 'package:firebase_messaging/firebase_messaging.dart';

/// Wraps Firebase Cloud Messaging setup for push notifications
/// (transfer status updates, KYC approval, security alerts).
class NotificationService {
  NotificationService._();

  static final NotificationService instance = NotificationService._();

  final FirebaseMessaging _messaging = FirebaseMessaging.instance;

  Future<void> init() async {
    await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    FirebaseMessaging.onMessage.listen(_handleForegroundMessage);
  }

  Future<String?> getDeviceToken() => _messaging.getToken();

  void _handleForegroundMessage(RemoteMessage message) {
    // TODO: surface an in-app notification/snackbar using a global
    // navigator key or an event bus once the UI layer is implemented.
  }
}
