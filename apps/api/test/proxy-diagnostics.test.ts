import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { installProxyDiagnostics } from '../src/proxy-diagnostics.js';

describe('bounded proxy measurements', () => {
  it('does not log when disabled', async () => {
    const app = express(); const log = vi.fn();
    installProxyDiagnostics(app, false, log);
    app.get('/api/health', (_req, res) => res.sendStatus(200));
    await request(app).get('/api/health?proxyProbe=off');
    expect(log).not.toHaveBeenCalled();
  });
  it('preserves right-hand fingerprints across forged prefixes without logging raw IPs', async () => {
    const app = express(); const log = vi.fn();
    app.set('trust proxy', 2);
    installProxyDiagnostics(app, true, log);
    app.get('/api/health', (_req, res) => res.sendStatus(200));
    await request(app).get('/api/health?proxyProbe=plain').set('X-Forwarded-For', '198.51.100.1, 10.0.0.1');
    await request(app).get('/api/health?proxyProbe=forged').set('X-Forwarded-For', '203.0.113.99, 198.51.100.1, 10.0.0.1');
    const first = log.mock.calls[0][1]; const second = log.mock.calls[1][1];
    expect(first.forwardedCount).toBe(2);
    expect(second.forwardedCount).toBe(3);
    expect(second.candidates.slice(0, 2)).toEqual(first.candidates);
    expect(second.resolved).toBe(first.resolved);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/198\.51|203\.0|10\.0/);
    for (let n = 0; n < 25; n++) await request(app).get('/api/health?proxyProbe=bounded');
    expect(log).toHaveBeenCalledTimes(20);
  });
});
