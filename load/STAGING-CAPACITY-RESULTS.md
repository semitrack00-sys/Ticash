# Staging capacity investigation — 2026-10-04

Status: **10,000-user health capacity has not passed.** The current blocker is Cloudflare's edge challenge on concentrated staging load. The diagnostic changes do not establish payment or recharge capacity.

Target: `https://ticash-api-staging-v2.onrender.com/api/health`, Render service `srv-daup1bp7lnhs739d6110`, deployed commit `aeb4e83149acb602c3297691b5b8c956af50ebe3`.

## Measured runs

| Run | Result |
| --- | --- |
| [Original single runner](https://github.com/semitrack00-sys/Ticash/actions/runs/37189138620) | 1,515,160 requests; 43.27% failures, mostly refused connections. Overlapped staging deployment. |
| [Four synchronized runners](https://github.com/semitrack00-sys/Ticash/actions/runs/37223818541) | All four began within 1 ms of the shared start and each reached 2,500 VUs. 1,722,593 requests; about 86.3% failures. Successful-response p95 576–617 ms, p99 3.29–3.37 s. |
| [Bounded challenge diagnostic](https://github.com/semitrack00-sys/Ticash/actions/runs/37224505625) | 170,320 requests before the failure gate stopped load during ramp. All 7,683 failed requests were HTTP 429. Samples on every runner identify Cloudflare challenges. This aborted run did not reach 10,000 VUs. |

The full distributed run had roughly 1.49 million HTTP errors and only 536 network errors. Render's CPU samples peaked at 0.318 cores and memory at 141,471,740 bytes. Successful application traffic fell sharply while edge challenges increased. No new deployment occurred during these runs.

## Confirmed response evidence

Diagnostic failures began around `2026-10-04T18:31:15Z`:

- HTTP status: `429`
- `Server: cloudflare`
- `CF-Mitigated: challenge`
- `Content-Type: text/html; charset=UTF-8`
- HTML title: `Just a moment...`
- Example ray IDs: `a4564331091f5ceb-IAD`, `a4564330bdab2628-DFW`, `a4564330593cf4a2-ORD`, `a4564332ad966689-ORD`.

These are edge challenge responses, not the application's JSON health response or its general client rate limiter. Normal probes returned HTTP 200 after the load ended. The application's health routes already skip the general client limiter.

## Next action

Request a supported staging load-test arrangement from Render before rerunning. Provide the service ID, host, UTC times, ray IDs, and workflow artifact links above. Ask Render to confirm which edge rule challenged the traffic and how to authorize a bounded staging-only test, ideally with known stable runner egress IPs and a fixed window. Do not weaken production security or increase paid compute merely to address edge rejection.

Suggested support request:

> We are testing our own staging service `srv-daup1bp7lnhs739d6110` at `ticash-api-staging-v2.onrender.com`. An authorized 10,000-VU health-only test from four synchronized GitHub runners is challenged at the edge. On 2026-10-04 at about 18:31:15 UTC, HTTP 429 responses contained `CF-Mitigated: challenge` and Cloudflare HTML. Example ray IDs are listed above. The API's health route is exempt from its application limiter and compute remains below limits. Please identify the managed edge rule and advise how to arrange an approved, bounded staging test window with stable runner IPs while retaining production protection. The linked workflow artifacts contain sampled headers and complete metrics.

This request has been prepared, not sent. The final workflow runs only on manual dispatch; temporary branch push triggers were removed.

Render documents its managed edge protection at https://render.com/docs/ddos-protection and https://render.com/articles/how-render-handles-ddos-attacks.
