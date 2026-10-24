import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var customerActions: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ bridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: bridge.pluginRegistry)
    let channel = FlutterMethodChannel(name: "com.ticash.flupflap/customer-actions",
      binaryMessenger: bridge.applicationRegistrar.messenger())
    customerActions = channel
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { return }
      switch call.method {
      case "identity":
        guard let raw = call.arguments as? String, !raw.contains("\\"),
              raw.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
              let parts = URLComponents(string: raw), parts.scheme == "https", parts.host == "verify.didit.me",
              parts.user == nil, parts.password == nil, parts.port == nil || parts.port == 443,
              parts.path.contains("/session/"), let url = parts.url else {
          result(FlutterError(code: "INVALID_IDENTITY", message: "Invalid verification address", details: nil))
          return
        }
        self.open(url, result: result)
      case "checkout":
        guard let raw = call.arguments as? String,
              let url = CustomerActionPolicy.checkoutURL(raw) else {
          result(FlutterError(code: "INVALID_CHECKOUT", message: "Invalid checkout address", details: nil))
          return
        }
        self.open(url, result: result)
      case "privacy":
        guard let action = call.arguments as? String,
              let url = CustomerActionPolicy.privacyURL(action) else {
          result(FlutterError(code: "INVALID_PRIVACY_ACTION", message: "Invalid privacy action", details: nil))
          return
        }
        self.open(url, result: result)
      case "share":
        guard let args = call.arguments as? [String: Any],
              let text = args["text"] as? String, !text.isEmpty else {
          result(FlutterError(code: "INVALID_SHARE", message: "Invalid share content", details: nil))
          return
        }
        let target = args["target"] as? String ?? "share"
        if target == "sms" || target == "whatsapp" {
          var parts = URLComponents()
          parts.scheme = target == "sms" ? "sms" : "whatsapp"
          if target == "whatsapp" { parts.host = "send" }
          parts.queryItems = [URLQueryItem(name: target == "sms" ? "body" : "text", value: text)]
          guard let url = parts.url else { self.unavailable(result); return }
          self.open(url, result: result)
        } else if target == "share" {
          guard let presenter = self.presenter() else { self.unavailable(result); return }
          let sheet = UIActivityViewController(activityItems: [text], applicationActivities: nil)
          sheet.popoverPresentationController?.sourceView = presenter.view
          sheet.popoverPresentationController?.sourceRect = CGRect(
            x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
          sheet.popoverPresentationController?.permittedArrowDirections = []
          presenter.present(sheet, animated: true) { result(nil) }
        } else {
          result(FlutterError(code: "INVALID_SHARE", message: "Invalid share target", details: nil))
        }
      default: result(FlutterMethodNotImplemented)
      }
    }
  }

  private func presenter() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    var controller = scenes.filter { $0.activationState == .foregroundActive }
      .flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController
    while let presented = controller?.presentedViewController { controller = presented }
    return controller
  }

  private func open(_ url: URL, result: @escaping FlutterResult) {
    UIApplication.shared.open(url, options: [:]) { [weak self] opened in
      if opened { result(nil) } else { self?.unavailable(result) }
    }
  }

  private func unavailable(_ result: FlutterResult) {
    // Never include checkout URLs, resume tokens or customer share content in logs/errors.
    result(FlutterError(code: "UNAVAILABLE", message: "The requested app is unavailable", details: nil))
  }
}

enum CustomerActionPolicy {
  static func checkoutURL(_ raw: String) -> URL? {
    guard !raw.contains("\\"),
          raw.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
          let parts = URLComponents(string: raw),
          parts.scheme == "https", parts.host == "checkout.stripe.com",
          parts.user == nil, parts.password == nil,
          parts.port == nil || parts.port == 443,
          parts.path.count > 1 else { return nil }
    let blocked = try! NSRegularExpression(pattern: "token|secret|transaction|order", options: .caseInsensitive)
    for item in parts.queryItems ?? [] {
      if blocked.firstMatch(in: item.name, range: NSRange(item.name.startIndex..., in: item.name)) != nil {
        return nil
      }
    }
    return parts.url
  }

  static func privacyURL(_ action: String) -> URL? {
    switch action {
    case "policy": return URL(string: "https://www.flupflap.com/legal/privacy/")
    case "deletionPage": return URL(string: "https://www.flupflap.com/legal/delete-account/")
    case "deletionEmail":
      var parts = URLComponents()
      parts.scheme = "mailto"
      parts.path = "contact@ticash-app.com"
      parts.queryItems = [
        URLQueryItem(name: "subject", value: "FlupFlap account deletion request"),
        URLQueryItem(name: "body", value: "Please delete my FlupFlap account and associated personal data.\n\nMy registered account email: \n\nPlease tell me about any verification steps, recurring recharges and records that need to be retained.")
      ]
      return parts.url
    default: return nil
    }
  }
}
