# TiCash architecture

## Trust boundary

The mobile client is untrusted. It can request a quote and submit a transfer, but it cannot calculate the authoritative fee, write status, call provider APIs directly, or possess provider credentials.

## Backend responsibilities

- Normalize Haiti phone numbers.
- Authoritatively calculate fees and limits.
- Authenticate customers.
- Enforce idempotency per customer.
- Persist a durable transfer record before calling a provider.
- Route to MonCash/NatCash adapters.
- Accept authenticated provider callbacks.
- Preserve provider transaction IDs for reconciliation.

## Transfer state machine

`PENDING -> PROCESSING -> COMPLETED | FAILED`

A completed transfer may later become `REVERSED` only through a controlled reconciliation or provider callback path.

## Provider adapter rule

Provider-specific authentication, signatures, field mapping, retry rules, status codes, settlement behavior and webhooks must be implemented from the approved provider contract. The generic live adapter in this MVP is intentionally not presented as production-ready.
