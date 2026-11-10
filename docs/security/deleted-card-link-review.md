# Recovering a legitimate buyer from a deleted-account card link

Deleting an account marks it restricted and retains its payment evidence. Reusing
the same card on a different account can therefore produce `LINKED_ACCOUNT_REVIEW`
even when the new Stripe payment is normal risk and all issuer checks pass. This
change provides a reviewed exception instead of deleting evidence or disabling the
global fraud gate. No exception is activated by deploying this code.

## Review and activation

An ADMIN or SUPER_ADMIN must verify ownership and examine the original assessment,
deleted-account history, and current Stripe charge. The new endpoint is deliberately
not available to customer tokens, SUPPORT, OPERATIONS, COMPLIANCE or READ_ONLY roles.

POST `/api/admin/flupflap/transactions/:id/deleted-card-link-review`, using the
existing authenticated staff session and this JSON body:

```json
{
  "linkedCustomerId": "<deleted-account UUID>",
  "reason": "<20–500 character explanation of the evidence reviewed>",
  "confirm": "APPROVE_DELETED_CARD_LINK"
}
```

The transaction must already be failed and refunded following a linked/shared-card
review. The server derives the buyer and card fingerprint from its assessment; it
does not accept a card fingerprint from the caller. Fresh Stripe evidence must
match that charge and card, confirm the refund, and pass every other payment check.
Only an active, unrestricted, non-guest buyer and a linked DELETED account qualify.

Approval lasts at most 30 days and is scoped to that buyer/card/deleted-account
combination. New accounts or cards do not inherit it. A restored account no longer
qualifies. New payments still undergo risk, CVC, ZIP, street, authentication,
dispute, refund, account, device, recipient, velocity and card-count checks. Any
other unreviewed linked account remains blocking. Previously refunded orders are
not retried or changed. The customer must make a new purchase after activation.

## Rollback

Send the same request with `confirm: "REVOKE_DELETED_CARD_LINK"`. Revocation does
not require Stripe availability. The latest decision replaces older approvals.
Verify a `FLUPFLAP_DELETED_CARD_LINK_REVOKED` audit record and that the next gate
evaluation returns the original link review. Never delete the approval audit.

For code rollback, revert this change and redeploy the prior API version. There is
no schema migration. Old code ignores these audit events and retains the original
link restriction. Neither rollback issues charges/refunds nor recalls delivered
airtime. No Stripe Dashboard/Radar rule change or Android release is needed for
this server-side repair.

## Validation before production

Run API typecheck, lint and tests. Test approval, revocation and expiry with a
non-production database, including the actual authenticated admin route. Production
activation is a separate, explicit staff decision; a passing test suite does not
approve any customer. Inspect the exact scope and obtain owner approval before
activating an exception. Do not place a live purchase as part of this procedure.
