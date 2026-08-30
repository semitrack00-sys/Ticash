# TiCash

TiCash is a mobile-first remittance platform designed to fund transfers and pay recipients in Haiti through approved payout rails such as Digicel MonCash and Natcom NatCash.

## Safety status

This repository is **not production-money enabled**. MonCash, NatCash, Stripe and PayPal credentials are intentionally blank. `PAYMENTS_MODE` and `PAYOUTS_MODE` default to `mock`. Do not enable real transfers until provider contracts, production credentials, webhook specifications, KYC/AML controls and operational reconciliation are approved.

## Architecture

- `apps/web` - Expo/React Native customer client with web support
- `apps/api` - Express + TypeScript REST API
- `packages/shared` - shared domain/API types
- `prisma` - PostgreSQL schema
- `.github/workflows` - CI validation

Flow: client -> TiCash API -> risk/KYC/ledger -> funding adapter -> payout adapter -> recipient.

## Local setup

1. Install Node.js 20+ and Docker.
2. Copy `.env.example` to `.env` and replace development secrets locally.
3. Run `npm install`.
4. Run `npm run prisma:generate`.
5. Run `docker compose up postgres -d`.
6. Run `npm run dev:api`.
7. Run `npm run dev:web` in another terminal.

Health check: `GET /api/v1/health`.

## Validation commands

- `npm run prisma:validate`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## Environment variables

Never commit `.env`. `.env.example` contains placeholders for database, JWT/encryption, Stripe, PayPal, MonCash, NatCash, email, SMS and Sentry configuration.

## Database migrations

During development use Prisma migrations after reviewing the generated SQL. Never run destructive schema changes against production without a backup and migration plan.

## Security baseline

- Security headers via Helmet
- Global API rate limiting
- Strict JSON body size
- Zod input validation utilities
- Secrets from environment variables only
- Server-side idempotency model
- Audit log model
- No provider secrets in the client

CSRF protection should be enabled for cookie-authenticated state-changing endpoints. If bearer tokens are used, keep them out of browser-accessible persistent storage and use a documented threat model.

## Provider behavior

MonCash and NatCash must remain behind adapters. Do not invent undocumented production endpoints, signing algorithms or callback behavior. Use mock/sandbox adapters until official provider documentation and credentials are available.

## Production blockers

Before handling real money: complete KYC/AML, fraud controls, regulatory/legal review, provider onboarding, payout reconciliation, encrypted secret management, incident response, monitoring, backups, disaster recovery, penetration testing and production webhook verification.
