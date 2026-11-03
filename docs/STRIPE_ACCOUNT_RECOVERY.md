# Recover an unpaid checkout after changing Stripe accounts

Changing the live Stripe key does not move existing Checkout Sessions to the new
account. A resource-missing response from the new account is not proof of failure.

Use the operator-only CLI from the deployed API service shell. It supports only
production FlupFlap reservations that are still SESSION_CREATED, have no payment
intent or fulfillment evidence, and match an unpaid Checkout Session exactly.
Paid or processing sessions require separate payment reconciliation.

1. Securely configure `STRIPE_RECOVERY_SECRET_KEY` with a live key for the old
   account. Do not replace `STRIPE_LIVE_SECRET_KEY`, and do not paste keys into
   chat, command arguments, source files or logs. Remove the recovery key afterward.
2. Run `node apps/api/dist/topup/legacy-checkout-recovery-cli.js TRANSACTION_ID CHECKOUT_SESSION_ID OLD_ACCOUNT_ID --dry-run`.
3. Review the exact account, transaction, amount and session status. Run the same
   command with `--apply` to expire and reconcile that single reservation.
4. Confirm `RECOVERED`, then check the transaction in the admin and reload the app.

The command checks the authenticated Stripe account, transaction metadata, live
mode and exact USD amount. It expires the old session, re-reads Stripe, and only
then updates the unchanged database record with a transactional audit and promotion
reconciliation. It invalidates the old resume token. It cannot charge, refund or
fulfill a recharge. Errors, races and missing sessions fail closed; rerun a dry run
to inspect after a failure. A successful expiry followed by a database failure can
be safely retried. Do not override a refused recovery by editing payment status.

New payments continue to use the existing production configuration. This tool
does not migrate saved recurring payment methods or add automatic multi-account
payment processing.
