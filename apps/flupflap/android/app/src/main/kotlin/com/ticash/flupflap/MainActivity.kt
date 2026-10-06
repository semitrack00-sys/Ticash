package com.ticash.flupflap

import android.content.Intent
import android.net.Uri
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity: FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.ticash.flupflap/customer-actions").setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "privacy" -> {
                        val action = call.arguments as? String
                        val uri = when (action) {
                            "policy" -> Uri.parse("https://www.flupflap.com/legal/privacy/")
                            "deletionPage" -> Uri.parse("https://www.flupflap.com/legal/delete-account/")
                            "deletionEmail" -> Uri.parse("mailto:contact@ticash-app.com").buildUpon()
                                .appendQueryParameter("subject", "FlupFlap account deletion request")
                                .appendQueryParameter("body", "Please delete my FlupFlap account and associated personal data.\n\nMy registered account email: \n\nPlease tell me about any verification steps, recurring recharges and records that need to be retained.")
                                .build()
                            else -> null
                        }
                        if (uri == null) {
                            result.error("INVALID_PRIVACY_ACTION", "Invalid privacy action", null)
                        } else {
                            val intent = Intent(if (action == "deletionEmail") Intent.ACTION_SENDTO else Intent.ACTION_VIEW, uri)
                            startActivity(intent)
                            result.success(null)
                        }
                    }
                    "checkout" -> {
                        val uri = Uri.parse(call.arguments as? String ?: "")
                        if (uri.scheme != "https" || uri.host != "checkout.stripe.com" || uri.userInfo != null || (uri.port != -1 && uri.port != 443)) {
                            result.error("INVALID_CHECKOUT", "Invalid checkout address", null)
                        } else {
                            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
                            result.success(null)
                        }
                    }
                    "share" -> {
                        val text = call.argument<String>("text") ?: ""
                        val target = call.argument<String>("target") ?: "share"
                        val intent = when (target) {
                            "sms" -> Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).putExtra("sms_body", text)
                            else -> Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                        }
                        if (target == "whatsapp") intent.setPackage("com.whatsapp")
                        startActivity(if (target == "share") Intent.createChooser(intent, null) else intent)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            } catch (_: Exception) {
                // Never log the checkout URL, resume capability or customer share data.
                result.error("UNAVAILABLE", "The requested app is unavailable", null)
            }
        }
    }
}
