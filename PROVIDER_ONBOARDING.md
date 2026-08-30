# Provider onboarding

## MonCash

Obtain official business/payout access and sandbox credentials from Digicel/MonCash. Confirm the exact payout endpoint, authentication flow, idempotency semantics, status endpoint, callback signing algorithm, error taxonomy, wallet limits, prefunding/settlement process, and reversal process.

Map those details into a dedicated `MonCashProvider` implementation before setting `PROVIDER_MODE=live`.

## NatCash

Obtain official payout/API access from Natcom/NatCash or a contractually approved aggregator. Confirm the same operational and security details as above. Do not reverse-engineer the consumer app or automate USSD for production money movement.

## Go-live gate

No live transfer should be enabled until both provider adapter contract tests and reconciliation tests pass against sandbox/production-certification environments.
