# TiCash + FlupFlap worldwide capacity test

This safe k6 harness ramps **500 -> 1,000 -> 2,500 -> 5,000 -> 10,000 concurrent virtual users**. It exercises only read-only health and FlupFlap country-catalog paths; it does not create payments, quotes, top-ups, customers, or provider transactions.

## Safety
Production is blocked by default. Run against staging with production-like infrastructure. Do not run destructive purchase-flow load tests against live Stripe, Reloadly, or other providers.

## Run

    BASE_URL=https://ticash-api-staging.onrender.com k6 run load/flupflap-capacity.js

## Gates
Error rate must stay below 1%, p95 below 1 second, and p99 below 2 seconds. Observe API CPU/RAM, database CPU/connections, 429/5xx responses, event-loop pressure, and provider latency. Stop a run if infrastructure becomes unhealthy rather than forcing the next stage.

The highest passing stage is a measured **read-path concurrency envelope for the tested environment**. It is not a guarantee for payment/recharge throughput or total registered subscribers. Provider/payment flows require separate rate-limit-aware tests using mocks/sandboxes.

## Worldwide scaling roadmap
The first major engineering target is 1M+ registered accounts and 10,000 concurrent active users. Before treating that as production capacity, validate database connection pooling, horizontal API scaling, queues for asynchronous provider/payment work, caching, observability/alerts, and provider rate limits. Multi-region deployment should be evaluated from measured traffic/geography and resilience requirements rather than assumed from account count alone.
