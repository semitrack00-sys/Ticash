# Gift-card pricing: $2 contribution target

The owner approved a USD 2 contribution per gift-card sale after provider,
wallet funding and payment processing costs. This is not net profit: refunds,
chargebacks, operating expenses and taxes are outside the calculation.

`priceGiftCard` is a server-side pricing foundation, not a live checkout.
There is currently no gift-card purchase flow in this backend. Existing airtime
and data-bundle fee schedules are unchanged.

All inputs are required. Supply the complete provider wallet debit for the
specific product and denomination in USD cents, including fees and discounts.
Do not extrapolate Uber Eats fees to Amazon or other brands. Supply the verified
processor fixed fee and applicable percentage, including applicable cross-border
or conversion charges. A 500-basis-point funding deduction means deposits credit
95%; zero must be explicitly verified, not assumed. Extra fixed funding costs
must be accounted for before this model is used in checkout.

Funding cost is rounded up to cents. The total is the ceiling of
`(funded provider cost + processor fixed fee + 200) / (1 - processor rate)`.
Percentage processing is conservatively rounded up. Total is never below face
value; deeply discounted products may therefore earn more than $2. Display face
value, service fee and total before payment. Keep supplier cost breakdown private.

Before wiring into live checkout: verify Reloadly gift-card API access, product
redemption restrictions, complete costs and Stripe eligibility. Bind a stored,
expiring server quote to product, quantity, country, currency, customer and fee
schedule; never accept client-supplied costs. Requote when payment method changes.
Implement payment-confirmed fulfillment, duplicate-order prevention, ambiguous
provider-result reconciliation and protected redemption-code delivery. Validate
the complete flow in sandbox before enabling sales. Do not assume this module
alone provides these features or guarantees actual settlement profit.

Example rates in tests (290 bps plus 30 cents) are illustrative, not verified
account pricing. Under conservative cent rounding, a 2,111-cent provider cost
quotes 2,411 cents without funding deduction, or 2,527 cents with a 5% deduction.
