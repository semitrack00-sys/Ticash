# Internet & Bundles visual review — issue #132

The shared Flutter recharge screen uses white cards, navy prices and purchase buttons,
light borders, a pale allowance panel and validity badge, and blue benefit checks.
The requester's written navy-button/blue-check rules take precedence over the brighter
buttons and green checks in the reference image.

Each card retains the reference's allowance / benefits / price hierarchy. At narrow
widths or large accessibility text sizes, benefits move below allowance and price.
Card height grows with provider content instead of clipping or dropping information.
The header, operator logo picker, bottom navigation, promo entry and review remain
part of the existing journey.

## Provider data

Production cards use `RechargeJourney.products` unchanged. Reloadly denomination
labels currently arrive in `name`; providers can also supply `description`, structured
`benefits` and `validityLabel`. The presenter accepts both shapes. Explicitly separated
provider clauses appear verbatim as benefits. Numeric data, bonus and duration labels
are extracted only from unambiguous complete clauses or structured metadata. App-specific
allowances are never added together. When extraction is uncertain, the card uses a
generic bundle label and exposes the complete original provider text in Plan details.

Buy Now selects the existing catalog product and requests the existing review quote.
It does not charge a card. Review still displays the server's provider amount,
FlupFlap fee and total before the existing payment confirmation. No price, API,
fee, recipient validation, Stripe, receipt or history implementation changes.

## Visual evidence

The screenshot fixtures are test-only examples, not a live catalog or published prices.
They use Reloadly's denomination-description shape without adding production mock data.
The pinned original screen is captured from commit
`50b06f3027b2143e664d66679acdfd511ee6ca34` using the same fixtures.

Screenshots cover 360, 412 and 1024 logical pixels, plus expanded long descriptions
at 320/360/412/1024 pixels with normal and 2× text. CI uploads both the original
and redesigned screens. The shared card also has Android and iOS theme tests.
These are actual Flutter-rendered screens, not HTML recreations or generated mockups.

## Reproduction

Run `flutter analyze` and `flutter test` from `apps/flupflap`.
The FlupFlap PWA workflow prepares deterministic visual-test fonts, captures the
before/after screens, builds the release web bundle and runs the existing browser,
offline-shell and checkout-return smoke tests. The Android workflow builds APK/AAB
QA artifacts and runs the existing manifest and release-build validation.

No merge, deployment or store upload is part of this change. Native iOS compilation
requires a macOS/Xcode runner; the shared widget tests cover its layout and action.
