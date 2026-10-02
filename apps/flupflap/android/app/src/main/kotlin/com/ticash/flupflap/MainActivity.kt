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
