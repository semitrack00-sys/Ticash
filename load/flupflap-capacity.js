import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Gauge, Rate } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
if (BASE_URL !== 'https://ticash-api-staging-v2.onrender.com') {
  throw new Error('Capacity testing is restricted to staging-v2.');
}
const requested = Number(__ENV.CAPACITY_LEVEL || 10000);
if (![25, 500, 1000, 2500, 5000, 10000].includes(requested)) throw new Error('Invalid CAPACITY_LEVEL.');
const shardCount = Number(__ENV.CAPACITY_SHARDS || 1);
const shard = Number(__ENV.CAPACITY_SHARD || 0);
const startAt = Number(__ENV.CAPACITY_START_AT || 0);
if (![1, 4].includes(shardCount) || !Number.isInteger(shard) || shard < 0 || shard >= shardCount || requested % shardCount !== 0) {
  throw new Error('Invalid capacity shard configuration.');
}
if (!Number.isFinite(startAt) || startAt < 0 || (shardCount > 1 && !startAt)) throw new Error('Distributed runs require a shared start time.');
const targetVus = requested / shardCount;
const actualStart = new Gauge('capacity_start_time');
const errors = new Rate('capacity_errors');
const networkErrors = new Counter('capacity_network_errors');
const httpErrors = new Counter('capacity_http_errors');
export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
  setupTimeout: '5m',
  scenarios: { health_ramp: { executor: 'ramping-vus', startVUs: 0,
    stages: [{ duration: '1m', target: targetVus }, { duration: '2m', target: targetVus }, { duration: '1m', target: 0 }],
    gracefulRampDown: '30s' } },
  thresholds: { http_req_failed: ['rate<0.01'], capacity_errors: ['rate<0.01'],
    'http_req_duration{status:200}': ['p(95)<1000', 'p(99)<2000'] },
};
export function setup() {
  const deadline = startAt || Date.now() + 120000;
  let healthy = 0;
  while (Date.now() < deadline) {
    const response = http.get(`${BASE_URL}/api/health`, { timeout: '10s', redirects: 0, responseType: 'text', tags: { endpoint: 'readiness' } });
    let ready = false;
    try { ready = response.status === 200 && response.json('status') === 'healthy' && response.json('mode') === 'postgresql'; } catch (_) { /* Retry readiness only. */ }
    healthy = ready ? healthy + 1 : 0;
    if (healthy >= 10) {
      if (startAt) sleep(Math.max(0, (startAt - Date.now()) / 1000));
      const actualStartAt = Date.now();
      if (startAt && actualStartAt > startAt + 2000) throw new Error('Runner missed the synchronized start; rerun the workflow.');
      actualStart.add(actualStartAt);
      return { actualStartAt };
    }
    sleep(3);
  }
  throw new Error('Staging did not remain healthy in PostgreSQL mode before the start deadline.');
}
let sampledErrors = 0;
export default function () {
  const response = http.get(`${BASE_URL}/api/health`, { timeout: '10s', redirects: 0, tags: { endpoint: 'health' } });
  const ok = check(response, { 'health 200': r => r.status === 200 });
  errors.add(!ok);
  if (!ok && __VU <= 4 && sampledErrors++ < 3) {
    console.error(JSON.stringify({ shard, timestamp: Date.now(), status: response.status, errorCode: response.error_code, error: response.error }));
  }
  if (response.status === 0) networkErrors.add(1, { error_code: String(response.error_code) });
  else if (!ok) httpErrors.add(1, { status: String(response.status) });
  sleep(1);
}
export function handleSummary(data) {
  data.capacity = { level: requested, shard, shardCount, startAt, targetVus, scope: 'health-only' };
  return { [`artifacts/capacity/shard-${shard}/summary.json`]: JSON.stringify(data, null, 2),
    stdout: `Capacity shard ${shard + 1}/${shardCount}: ${targetVus} target VUs; diagnostics saved.\n` };
}
