const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { aggregate } = require('./aggregate-capacity.cjs');
const source = fs.readFileSync(path.join(__dirname, 'flupflap-capacity.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/export default function/g, 'function run').replace(/export /g, '');
function configure(env) {
  const metric = class { add() {} };
  return vm.runInNewContext(`${source}\noptions;`, { __ENV: env, Counter: metric, Gauge: metric, Rate: metric });
}
const env = { BASE_URL: 'https://ticash-api-staging-v2.onrender.com', CAPACITY_LEVEL: '10000', CAPACITY_SHARDS: '4', CAPACITY_SHARD: '0', CAPACITY_START_AT: '180000' };
test('production and arbitrary targets cannot be enabled by an override', () => {
  for (const BASE_URL of ['https://ticash-api.onrender.com', 'https://example.com', '']) {
    assert.throws(() => configure({ ...env, BASE_URL, ALLOW_PRODUCTION: 'YES' }), /restricted/);
  }
});
test('distributed load requires valid shards and a common start', () => {
  assert.throws(() => configure({ ...env, CAPACITY_START_AT: '0' }), /shared start/);
  assert.throws(() => configure({ ...env, CAPACITY_SHARD: '4' }), /shard/);
  const options = configure(env);
  assert.equal(options.scenarios.health_ramp.stages[1].target, 2500);
  assert.ok(options.summaryTrendStats.includes('p(99)'));
});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capacity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let shard = 0; shard < 4; shard++) {
    const dir = path.join(root, `shard-${shard}`);
    fs.mkdirSync(dir);
    const metrics = Object.fromEntries(Object.entries({ http_reqs: { count: 10000 }, vus: { max: 2500 }, capacity_start_time: { value: 180000 }, capacity_errors: { rate: 0 }, http_req_failed: { rate: 0 }, 'http_req_duration{status:200}': { 'p(95)': 30, 'p(99)': 60 } }).map(([key, values]) => [key, { values }]));
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ capacity: { level: 10000, shard, shardCount: 4, startAt: 180000, targetVus: 2500, scope: 'health-only' }, metrics }));
    fs.writeFileSync(path.join(dir, 'result.txt'), 'k6_exit_code=0\n');
  }
  return root;
}
function mutate(root, change) {
  const file = path.join(root, 'shard-3', 'summary.json');
  const data = JSON.parse(fs.readFileSync(file));
  change(data);
  fs.writeFileSync(file, JSON.stringify(data));
}
test('aggregate requires every shard, concurrency, timing and threshold', t => {
  const cases = [
    d => { d.metrics.vus.values.max = 2499; },
    d => { d.metrics.capacity_start_time.values.value += 3000; },
    d => { d.metrics.capacity_errors.values.rate = 0.02; },
    d => { d.metrics['http_req_duration{status:200}'].values['p(99)'] = 2001; },
    d => { d.capacity.shard = 0; },
  ];
  for (const change of cases) {
    const root = fixture(t);
    assert.equal(aggregate(root, 10000, 4, 180000).passed, true);
    mutate(root, change);
    assert.equal(aggregate(root, 10000, 4, 180000).passed, false);
  }
  const root = fixture(t);
  fs.rmSync(path.join(root, 'shard-3'), { recursive: true });
  assert.equal(aggregate(root, 10000, 4, 180000).passed, false);
});
