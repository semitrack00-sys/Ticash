# FlupFlap capacity load test

Safe k6 harness that ramps 25 -> 100 -> 250 -> 500 concurrent virtual users. It exercises only read-only health and country-catalog paths; it does not create payments, quotes, top-ups, customers, or provider transactions.

Production is blocked by default. Prefer staging with production-equivalent CPU, memory, database, connection settings, and provider behavior. Do not run destructive purchase-flow load tests against live Stripe or Reloadly.

Run: `BASE_URL=https://your-staging-api.example k6 run load/flupflap-capacity.js`

Capacity gates: error rate below 1%, p95 below 1 second, p99 below 2 seconds. Watch API CPU/RAM, DB CPU/connections, 5xx/429s, and provider latency. The highest passing stage is a measured read-path concurrency envelope for that environment, not a promise for checkout throughput.
