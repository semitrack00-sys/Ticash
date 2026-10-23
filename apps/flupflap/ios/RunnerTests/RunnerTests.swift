import XCTest
@testable import Runner

final class RunnerTests: XCTestCase {
  func testHostedCheckoutAcceptsOnlyStripeHTTPS() {
    XCTAssertNotNil(CustomerActionPolicy.checkoutURL("https://checkout.stripe.com/c/pay/cs_live_example"))
    XCTAssertNotNil(CustomerActionPolicy.checkoutURL("https://checkout.stripe.com:443/c/pay/example"))
    for url in [
      "http://checkout.stripe.com/c/pay/example",
      "https://checkout.stripe.com.evil.example/c/pay/example",
      "https://evil.example@checkout.stripe.com/c/pay/example",
      "https://checkout.stripe.com:444/c/pay/example",
      "https://checkout.stripe.com/",
      "https://checkout.stripe.com/c/pay/example?client_secret=hidden",
      "https://checkout.stripe.com/c/pay/example?checkoutResumeToken=hidden",
      "https://checkout.stripe.com/c/pay/example\n"
    ] {
      XCTAssertNil(CustomerActionPolicy.checkoutURL(url), "Unsafe checkout URL was accepted")
    }
  }

  func testPrivacyActionsCannotOpenArbitraryDestinations() {
    XCTAssertEqual(CustomerActionPolicy.privacyURL("policy")?.absoluteString,
                   "https://www.flupflap.com/legal/privacy/")
    XCTAssertEqual(CustomerActionPolicy.privacyURL("deletionPage")?.host, "www.flupflap.com")
    let mail = URLComponents(url: CustomerActionPolicy.privacyURL("deletionEmail")!, resolvingAgainstBaseURL: false)!
    XCTAssertEqual(mail.scheme, "mailto")
    XCTAssertEqual(mail.path, "contact@ticash-app.com")
    XCTAssertTrue(mail.queryItems!.contains { $0.name == "subject" && $0.value == "FlupFlap account deletion request" })
    XCTAssertNil(CustomerActionPolicy.privacyURL("https://evil.example"))
  }
}
