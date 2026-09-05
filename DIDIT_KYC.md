# Didit KYC setup

TiCash integrates Didit through a backend-created verification session and the
official native Flutter SDK. The Flutter app receives only a short-lived session
token. `DIDIT_API_KEY` and `DIDIT_WEBHOOK_SECRET` must remain in the backend secret
manager and must never be passed to the app, printed in logs, or committed.

## Local configuration

Copy `.env.example` to an ignored local `.env` and configure:

```dotenv
DIDIT_ENABLED=false
DIDIT_API_KEY=your-server-side-api-key
DIDIT_WEBHOOK_SECRET=your-destination-shared-secret
DIDIT_WORKFLOW_ID=00000000-0000-0000-0000-000000000000
DIDIT_BASE_URL=https://verification.didit.me
```

Keep `DIDIT_ENABLED=false` until the workflow and webhook destination are ready.
The API starts normally without Didit credentials while it is disabled. When enabled,
all three secret/workflow values are required and the base URL must use HTTPS.

## Didit Business Console configuration

1. Create or select the TiCash application for the correct environment.
2. Configure and publish the TiCash customer-verification workflow, then copy its UUID
   into `DIDIT_WORKFLOW_ID`.
3. Under **API & Webhooks**, create a public HTTPS webhook destination for
   `POST https://your-api.example.com/api/webhooks/didit`.
4. Select webhook version `v3` and subscribe to `status.updated` and `data.updated`.
5. Copy the destination's one-time `secret_shared_key` into the backend secret manager
   as `DIDIT_WEBHOOK_SECRET`.
6. Use Didit's webhook tester for Approved, Declined, and In Review before enabling the
   integration outside a controlled test environment.
7. Configure Didit white-label/consent text and data-retention settings with TiCash's
   compliance and privacy requirements.

The endpoint verifies `X-Signature-V2` first, supports the exact raw-body
`X-Signature` fallback, rejects timestamps outside five minutes, and deduplicates on
Didit's `event_id`. The app never sends an approval status to the backend. Webhooks are
the primary source of truth; `GET /api/kyc/status?refresh=true` performs an authenticated
server-to-server reconciliation after the native SDK closes.

## API and mobile flow

- `POST /api/kyc/session` — authenticated, rate-limited session creation.
- `GET /api/kyc/status` — authenticated stored status.
- `GET /api/kyc/status?refresh=true` — server-side Didit decision reconciliation.
- `POST /api/webhooks/didit` — public signed webhook receiver.

The mobile **Identity verification** screen launches the official
`didit_sdk_autodetection` package with the session token returned by TiCash. Camera,
microphone, and photo-library usage descriptions are configured for iOS; Android uses
API 23 or newer as required by the SDK. SDK completion is only a UI signal. The backend
must store `APPROVED` before quote, transfer, or ACH funding endpoints can proceed.

TiCash stores only session/status metadata. It does not download or retain identity
documents, selfies, session tokens, or full Didit decision payloads.
