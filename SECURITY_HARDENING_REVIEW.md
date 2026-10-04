# TiCash and FlupFlap hardening review — 2026-10-04

Scope: current TiCash repository API, TiCash mobile app, and FlupFlap Android app. The separately hosted website repository, production infrastructure settings, signing keys, and complete Git history were not assessed in this code review.

## Changes

- Constrain both mobile clients to their configured API scheme, host, port, and API path before attaching bearer tokens or sending credentials. FlupFlap also retains its namespace restriction. Disable automatic redirects on authenticated and refresh requests, including caller overrides.
- Permit TiCash HTTP only for explicitly local development in non-release builds. Production builds require an HTTPS `API_BASE_URL`; FlupFlap retains its HTTPS-only configuration.
- Recursively redact credential, cookie, payment-card, and account fields in audit metadata, including nested arrays. Bound recursion and handle circular references without mutating the original event.
- Parse malformed authentication cookies safely, preserving refresh-token validation and the browser-origin guard.
- Disable Android backup and plaintext traffic in the TiCash main manifest, matching FlupFlap's existing protections. The existing TiCash debug manifest permits local development HTTP; the transport guard still rejects remote HTTP.
- Update the locked `ip-address` dependency from 10.7.0 to 10.7.3, addressing GHSA-j6r3-76f7-8jcv and GHSA-h3mg-xc3c-68pw. No unrelated dependency upgrades.

## Existing controls reviewed

Backend regressions exercise separate TiCash/FlupFlap identities, owner-scoped quotes and receipts, server-side staff permissions, account restrictions, one-time refresh rotation, password-reset revocation, signed provider webhooks, idempotent checkout, authoritative status transitions, and production approval gates. API responses already use no-store headers, and webhook payloads have bounded body sizes.

The current tracked text tree had no matches for the high-confidence live Stripe key, AWS access key, or private-key patterns checked. This is a limited pattern scan, not a full secret-history audit. No credentials were rotated.

## Validation and rollout

The API suite, TypeScript checks, lint, build, and production dependency audit are run with this change. Mobile analysis/tests and packaging are checked by CI. Record final CI results in the pull request.

Deploy the API changes and distribute newly built mobile apps after review. Existing installed APKs retain their previous behavior. QA APKs are debug builds; public distribution still requires the configured production signing key and a release build. This review does not certify the entire system or replace a penetration test.
