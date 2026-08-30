# TiCash

TiCash is a Haiti-focused money-transfer MVP for routing payouts to MonCash and NatCash wallets.

## Safety status

This repository ships in **MOCK provider mode**. It cannot send real money until approved provider credentials and production endpoint mappings are supplied. Never place provider secrets in the mobile app.

## Architecture

- `apps/mobile`: Expo / React Native customer application
- `apps/api`: Fastify + TypeScript backend
- `apps/api/prisma`: PostgreSQL data model
- `docs`: architecture, provider onboarding, security, and launch checklist

## Core flow

1. Sign in with phone + OTP.
2. Create a transfer quote.
3. Confirm the recipient, provider, amount, and fee.
4. Submit with an idempotency key.
5. Backend routes the transfer through a provider adapter.
6. Provider callbacks or status checks finalize the transfer.
7. Transaction history and receipts are read from TiCash's ledger.

## Quick start

Requirements: Node.js 20+, npm, PostgreSQL 15+.

```bash
cp apps/api/.env.example apps/api/.env
npm install
npm --workspace apps/api run prisma:generate
npm --workspace apps/api run prisma:migrate
npm run dev:api
```

In another terminal:

```bash
cp apps/mobile/.env.example apps/mobile/.env
npm run dev:mobile
```

API defaults to `http://localhost:4000`. Android emulators normally need `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000`.

## Production blockers

Before real-money launch you still need provider/business approval, production credentials, KYC/AML policy, sanctions screening where applicable, transfer limits, reconciliation, dispute/refund procedures, security review, monitoring, and legal/compliance sign-off for the markets where TiCash operates.
