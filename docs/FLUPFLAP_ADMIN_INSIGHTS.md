# FlupFlap admin records and country totals

Open **TiCash Operations → FlupFlap**. Dashboard metric cards open their
underlying records. The financial cards explain their calculation and list the
contributing transactions. Amounts use stored USD cents; completed recharge
sales exclude the separately recorded fee. Fee receipts are not net profit.

**Clients by country** groups the country saved on the client profile. It does
not infer residence from a phone number or recharge destination. Missing or
malformed profile countries belong to **Not provided**, which is included in
the overall total. Historical guest accounts remain distinguishable from
registered clients. These counts cover the complete database, not one page.

Tap a country or **Total clients**, or open **FlupFlap Customers**, to use the
client directory. Search partial names, emails (case insensitive), or phone
numbers with or without punctuation. Search and country filters run on the
server across all records. Pages contain 25 records and expose the full matching
count. Opening a client shows contact, account state, **Registered on** (or
**Account created** for historical guests), last sign-in and recorded activity.
All displayed dates are explicitly UTC. Registration is not presented as a paid
subscription; this backend has no paid-subscription records.

Authorized administrators can access **Reset purchase-attempt limit** directly
from the client card and profile. The existing reason, audit and payment safety
checks still apply; viewing details never resets a limit or changes a payment.

## Read-only API and access

- `/api/admin/flupflap/customer-directory` requires customer-view permission.
- `/api/admin/flupflap/analytics/details` requires report permission plus the
  applicable customer-view or transaction-view permission.
- Transaction contact/recipient details additionally require customer-view
  permission. Search cannot infer redacted contact information.
- Both APIs are `no-store`, validate metric, date, pagination and country inputs,
  bind SQL values, and fail unavailable when the database is absent.
- A displayed analytics end timestamp carries into drill-down. Each response
  computes its matching total, country counts, metric value and page in one
  statement. Status changes after opening the dashboard can update detail totals.
- Explicit response fields exclude passwords, authentication state, payment
  session tokens, idempotency keys and request hashes.

No pricing, purchase limits, verification policy or payment operations change.
No schema migration or customer Android release is required.
