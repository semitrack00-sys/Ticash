import { loadMobileTopUpConfig } from './config.js';
import { ReloadlySandboxTopUpProvider } from './reloadly-provider.js';
import { verifyDtOnePreproduction } from './dtone-diagnostic.js';

// No server, database, payment provider, or transaction service is initialized.
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--coverage' && arg !== '--compare-reloadly' && !/^--country=[A-Z]{2}$/.test(arg))) {
    console.log(JSON.stringify({ provider: 'DTONE', environment: 'PREPRODUCTION', connected: false, complete: false, errorCode: 'INVALID_ARGUMENT' }));
    process.exitCode = 1;
    return;
  }
  const reloadlyCountries = args.includes('--compare-reloadly') ? async () => {
    const config = loadMobileTopUpConfig(process.env);
    if (config.environment !== 'sandbox' || config.liveRechargeEnabled) throw new Error();
    const readonlyFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!(url === 'https://auth.reloadly.com/oauth/token' && init?.method === 'POST') &&
          !(url === 'https://topups-sandbox.reloadly.com/countries' && (init?.method ?? 'GET') === 'GET')) throw new Error();
      const response = await fetch(input, { ...init, redirect: 'error' });
      // Keep upstream error bodies/headers away from Reloadly's existing logger.
      if (!response.ok) throw new Error('Read-only comparison unavailable');
      const body: unknown = await response.json();
      let safeBody: unknown;
      if (url.endsWith('/countries')) {
        if (!Array.isArray(body)) throw new Error('Invalid comparison response');
        safeBody = body;
      } else {
        if (!body || typeof body !== 'object' || !('access_token' in body) || typeof body.access_token !== 'string' ||
            !body.access_token || !('expires_in' in body) || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in)) throw new Error('Invalid comparison response');
        safeBody = { access_token: body.access_token, expires_in: body.expires_in };
      }
      return new Response(JSON.stringify(safeBody), { status: response.status, headers: { 'Content-Type': 'application/json' } });
    };
    return new ReloadlySandboxTopUpProvider(config, readonlyFetch).listCountries();
  } : undefined;
  const result = await verifyDtOnePreproduction(process.env, { coverage: args.includes('--coverage'),
    country: args.find(arg => arg.startsWith('--country='))?.split('=')[1], reloadlyCountries });
  console.log(JSON.stringify(result, null, 2));
  if (!result.complete) process.exitCode = 1;
}
main().catch(() => {
  console.log(JSON.stringify({ provider: 'DTONE', environment: 'PREPRODUCTION', connected: false, complete: false, errorCode: 'DIAGNOSTIC_FAILED' }));
  process.exitCode = 1;
});
