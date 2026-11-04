import { createHmac, randomBytes } from 'node:crypto';
import type { Express } from 'express';

// Opt-in, bounded staging measurement. Never emit addresses or credentials.
export function installProxyDiagnostics(app: Express, enabled: boolean, log = console.info) {
  if (!enabled) return;
  const salt = randomBytes(32);
  let remaining = 20;
  const fingerprint = (value: string) => createHmac('sha256', salt).update(value).digest('hex').slice(0, 16);
  app.use((req, _res, next) => {
    const probe = req.query.proxyProbe;
    if (remaining > 0 && req.method === 'GET' && req.path === '/api/health' &&
        typeof probe === 'string' && /^[a-zA-Z0-9-]{1,40}$/.test(probe)) {
      remaining--;
      const forwarded = (req.get('x-forwarded-for') ?? '').split(',').map(value => value.trim()).filter(Boolean);
      log('STAGING_PROXY_DIAGNOSTIC', {
        probe, forwardedCount: forwarded.length,
        // Right-most first, matching Express's numeric trust traversal.
        candidates: forwarded.slice(-10).reverse().map(fingerprint),
        resolved: fingerprint(req.ip ?? ''),
        socket: fingerprint(req.socket.remoteAddress ?? ''),
      });
    }
    next();
  });
}
