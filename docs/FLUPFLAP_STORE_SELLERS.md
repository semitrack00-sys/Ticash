# FlupFlap Recharge store sellers

Stores use a registered FlupFlap customer identity and a separate, administrator-approved store profile. Guests cannot apply or purchase as a store. Stores never receive TiCash staff access or a TiCash remittance wallet.

## Agreed pricing

The starting store commission is **20% of the actual service fee**, rounded to the nearest cent. FlupFlap charges a flat 17% service fee for airtime, data and bundles. A $10 recharge costs the customer $11.70; the store earns $0.34 and FlupFlap retains $1.36 of the fee before costs. Commission settings affect new purchases only; each order retains its original rate and amounts. Country/operator costs still need to be checked when enabling a market.

## Seller flow

Open Account → Store seller account in the FlupFlap app/PWA. Apply with the store name, contact, international phone, street address/city and country. An administrator reviews the business and activates its account. Registration covers North America, Latin America, South America and Europe; registration does not imply country activation.

The initial release uses **USD balances and receipts**. Sellers contact contact@ticash-app.com for approved deposit instructions, send funds using that process, and submit the transfer reference and amount. A deposit request never creates spendable funds. Authorized staff independently verify receipt before crediting the balance. No bank transfer, card charge, currency conversion or payment-provider integration is initiated by these endpoints.

The seller enters the recipient country and phone, loads the existing provider catalog, selects airtime or an internet plan, and reviews the phone, product, recipient value, fee and total. After collecting customer payment, the seller sends the recharge using the store balance. Purchases use the existing recharge engine, product revalidation, provider operation claims and reconciliation worker. Ordinary customer/card checkout is unchanged.

The balance is debited before submission. Delivery credits the commission to the store balance. Confirmed failures return the reserved amount. Provider refunds after delivery return the charged amount less the commission already credited, leaving no retained earnings for the refunded sale. Unknown provider outcomes retain the reservation and require reconciliation; they never trigger another provider purchase. The app retries the same quote with the same idempotency key after a network error.

History shows the latest 50 sales, deposits and balance entries, plus total net commissions on delivered orders. Sale receipts include transaction ID, phone, product, total and current payment/delivery status. Pending sales refresh automatically while open. These records are operational receipts, not country-specific fiscal invoices.

## Admin

Operations → FlupFlap → Store Sellers has store search, pagination, approval/suspension/rejection, commission settings and pending deposit reviews. Deposit crediting requires an explicit receipt-of-funds confirmation. Completed external balance returns have a separate confirmation and reference; recording one deducts the balance, it does not initiate payment.

- `recharge.stores.view`: ADMIN/SUPER_ADMIN, OPERATIONS, READ_ONLY.
- `recharge.stores.manage`: ADMIN/SUPER_ADMIN only.
- `recharge.stores.funding`: ADMIN/SUPER_ADMIN only.

The server also requires `admin.view` and `recharge.view`. All store access uses the authenticated owner; customer UUIDs, balances, roles and commission amounts are never accepted from seller request bodies. Funding references are unique and reviewed requests cannot be changed into another outcome.

## Deployment

Migration: `20261022010000_flupflap_store_sellers`. It adds store, deposit, order and append-only balance-entry tables, plus the STORE_BALANCE payment provider. Existing identities, balances and transactions are not rewritten. Apply using the normal Prisma migration deployment before running this API version. Deploy the API, admin web build and FlupFlap app/PWA together. Signed mobile store releases remain a separate publishing step.

Feature defaults disabled:

```
FLUPFLAP_STORES_ENABLED=false
FLUPFLAP_STORE_COUNTRIES=
```

After the migration and operational setup, explicitly set the feature to `true` and configure a comma-separated list of reviewed store-location country codes, for example `US,CA,MX,BR,FR`. This list controls store activation and purchases; it does not change recipient/provider coverage. Existing live recharge gates still apply. An empty list allows applications but no activation, deposits or sales. No countries or live money settings are enabled by this patch. Turning off the feature blocks new seller requests; settlement and refunds for already-funded store transactions remain available to the recharge worker.

Test stores and production stores are distinct records, with separate balances and ledger accounts. Switching recharge environment cannot promote simulated funds to real funds. This initial version has manual funding verification, no credit sales, automatic bank funding, cash withdrawal integration, tax calculation or local currency pricing.

## Accounting and recovery

Integer-cent wallet movements and double-entry USD accounting journals are committed in the same serializable database transaction as the order/payment change. Customer and store locks protect authorization and spending. Each deposit, debit, commission and refund has a unique reference. Orders preserve commission/pricing snapshots. The shared card-clearing ledger is not used for store sales.

The existing worker repairs captured store payments interrupted before provider submission, and delivered orders interrupted before commission settlement. An authorization that fails for insufficient funds can be retried with the same quote/key after a verified deposit, while its price is still valid. The worker cancels expired unfunded reservations without contacting the provider. Promotional redemptions are excluded from store purchases to prevent combining reseller earnings with consumer incentives.

Deletion immediately revokes seller access and suspends the store. It waits for outstanding orders and balances to settle. Staff can record a completed external balance return, including balances below $1. Once drained, store contact details are erased while accounting entries and opaque links are retained. Pending deposit requests are rejected during erasure.

## Validation

`TZ=UTC npm test --workspace @ticash/api` runs the API suite. Store tests use the existing embedded PostgreSQL/Prisma adapter and apply every migration; no external database or payment provider is contacted. Embedded PostgreSQL serializes whole transactions, so these tests exercise simultaneous application requests without claiming multi-connection load testing. Validate real PostgreSQL deployment through normal staging checks before enabling countries.

Seller API: `/api/flupflap/stores` (`GET /`, `POST /application`, `/funding`, `/quotes`, `/purchases`). Admin API: `/api/admin/flupflap/stores` (`GET /`, `PATCH /:id`, `POST /funding/:id/review`, `POST /:id/balance-return`). All responses are `no-store`.
