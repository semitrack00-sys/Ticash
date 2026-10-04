# Staging health capacity test

This k6 harness tests only `GET /api/health` on `https://ticash-api-staging-v2.onrender.com`. Other hosts, including production, are blocked. It does not exercise catalogs, databases through business requests, payments, top-ups, or providers.

Choose one maximum load level: 25, 500, 1,000, 2,500, 5,000, or 10,000 concurrent virtual users. Each run ramps to that level over one minute, holds it for two minutes, and ramps down over one minute. Each user waits one second after each request; virtual users are not requests per second.

The **Staging capacity test** GitHub workflow splits the 10,000-user run across four runners with 2,500 users each. All runners wait for a common start time after ten consecutive healthy PostgreSQL-mode readiness checks. A runner that misses the start fails the run. Avoid staging deployments during a capacity run; readiness checks cannot prevent a deployment that begins later.

For a single-runner local check:

    BASE_URL=https://ticash-api-staging-v2.onrender.com CAPACITY_LEVEL=25 k6 run load/flupflap-capacity.js

Create `artifacts/capacity/shard-0` first for summary output. The workflow handles directories and uploads all shard diagnostics plus the aggregate report.

Every shard must reach its requested concurrency, finish successfully, keep errors below 1%, and keep successful-response latency below 1 second at p95 and 2 seconds at p99. Network errors and non-200 HTTP responses are counted separately. Load requests are not retried. Readiness requests may retry before load begins.

A passing run measures staging health-endpoint capacity only. Payment/recharge capacity requires separate sandbox tests that cover database work, queues, business endpoints, and provider rate limits.
