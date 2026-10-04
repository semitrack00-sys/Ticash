const fs = require('node:fs');
const path = require('node:path');
function aggregate(root, level, count, startAt) {
  const failures = [];
  const shards = [];
  for (let shard = 0; shard < count; shard++) {
    const dir = path.join(root, `shard-${shard}`);
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
      const meta = data.capacity;
      if (!meta || meta.level !== level || meta.shard !== shard || meta.shardCount !== count || meta.startAt !== startAt || meta.targetVus !== level / count || meta.scope !== 'health-only') throw new Error('metadata mismatch');
      const values = name => data.metrics[name]?.values;
      const actualStartAt = values('capacity_start_time')?.value;
      if (startAt && !(Math.abs(actualStartAt - startAt) <= 2000)) failures.push(`Shard ${shard}: synchronized start was not verified`);
      const latency = values('http_req_duration{status:200}');
      const requests = values('http_reqs')?.count;
      const peak = values('vus')?.max;
      const errorRate = values('capacity_errors')?.rate;
      if (!(requests > 0) || !(peak >= level / count)) failures.push(`Shard ${shard}: requested concurrency was not reached`);
      if (!(errorRate < 0.01) || !(values('http_req_failed')?.rate < 0.01)) failures.push(`Shard ${shard}: error rate must be below 1%`);
      if (!(latency?.['p(95)'] < 1000) || !(latency?.['p(99)'] < 2000)) failures.push(`Shard ${shard}: successful-response latency exceeded limits`);
      if (fs.readFileSync(path.join(dir, 'result.txt'), 'utf8').trim() !== 'k6_exit_code=0') failures.push(`Shard ${shard}: k6 failed`);
      shards.push({ shard, actualStartAt, requests, peakVus: peak, errorRate, p95: latency?.['p(95)'], p99: latency?.['p(99)'], networkErrors: values('capacity_network_errors')?.count || 0, httpErrors: values('capacity_http_errors')?.count || 0 });
    } catch (error) { failures.push(`Shard ${shard}: ${error.message}`); }
  }
  return { passed: failures.length === 0, scope: 'health-only', level, shardCount: count, startAt, requests: shards.reduce((sum, s) => sum + s.requests, 0), shards, failures };
}
module.exports = { aggregate };
if (require.main === module) {
  const [root, level, count, startAt] = process.argv.slice(2);
  const report = aggregate(root, Number(level), Number(count), Number(startAt));
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
