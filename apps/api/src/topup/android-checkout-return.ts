import { randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';

// Fixed first-party HTTPS handoff, never a caller-supplied redirect URL.
// Existing web return URLs are untouched unless the FlupFlap-only Android
// payment-session contract is explicitly requested.
export const ANDROID_CHECKOUT_RETURN_URL = 'https://ticash-api.onrender.com/api/flupflap/mobile-topups/checkout-return';
export const androidCheckoutReturn: RequestHandler = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  const token = req.query.checkoutResumeToken;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,512}$/.test(token)) {
    res.status(400).type('text').send('Invalid checkout return');
    return;
  }
  // The capability grants read-only status access. This page performs no
  // payment/recharge action, loads no third parties and contains no auth token.
  const encoded = encodeURIComponent(token);
  // Only these per-response inline blocks can run; no remote resources or
  // status/mutation requests are permitted. The capability stays in links.
  const nonce = randomBytes(18).toString('base64');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#082b55">
  <title>Returning to FlupFlap</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; min-height: 100svh; display: grid; place-items: center; padding: 24px 16px; color: #082b55; background: radial-gradient(ellipse at top, #dfedff, #f6f8fc 65%); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { width: 100%; max-width: 420px; padding: 36px 24px 28px; text-align: center; background: #fff; border: 1px solid #e5eaf2; border-radius: 28px; box-shadow: 0 20px 60px #082b5510; }
    .wordmark { margin: 0 0 36px; color: #1677ff; font-size: 30px; font-weight: 800; letter-spacing: -1px; }
    .indicator { display: grid; place-items: center; width: 76px; height: 76px; margin: 0 auto 24px; border-radius: 50%; background: #e9f2ff; }
    .spinner { width: 36px; height: 36px; border: 3px solid #c5dcff; border-top-color: #1677ff; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
    h1 { margin: 0 0 12px; font-size: clamp(23px, 6vw, 28px); line-height: 1.2; letter-spacing: -.6px; }
    .description { margin: 0; color: #52647b; font-size: 16px; line-height: 1.6; }
    .actions { margin-top: 28px; }
    [hidden] { display: none !important; }
    .hint { margin: 0 0 16px; color: #52647b; font-size: 14px; line-height: 1.5; }
    a { display: block; padding: 15px 12px; border-radius: 14px; font-size: 15px; font-weight: 650; line-height: 1.4; text-decoration: none; overflow-wrap: anywhere; }
    .primary { color: #fff; background: #1265dd; }
    .secondary { margin-top: 10px; color: #1257a5; background: #e9f2ff; }
    a:focus-visible { outline: 3px solid #082b55; outline-offset: 4px; }
    a:hover { filter: brightness(.95); }
    .footer { margin: 28px 0 0; color: #64748b; font-size: 12px; line-height: 1.5; }
  </style>
</head>
<body>
  <main aria-labelledby="return-title">
    <p class="wordmark">FlupFlap</p>
    <div class="indicator" aria-hidden="true"><div class="spinner"></div></div>
    <h1 id="return-title">Returning to FlupFlap</h1>
    <p class="description">We're securely checking your payment and recharge status.</p>
    <div id="fallback" class="actions">
      <p class="hint" role="status">Still here? Choose how you'd like to continue.</p>
      <a id="open-app" class="primary" href="intent://checkout-return?checkoutResumeToken=${encoded}#Intent;scheme=flupflap;package=com.ticash.flupflap;end">Open FlupFlap App</a>
      <a class="secondary" href="https://www.flupflap.com/?checkoutResumeToken=${encoded}">Continue on Website</a>
    </div>
    <p class="footer">Your latest status will appear in FlupFlap.</p>
  </main>
  <script nonce="${nonce}">
    (() => {
      const fallback = document.getElementById('fallback');
      const openApp = document.getElementById('open-app');
      const showFallback = () => { fallback.hidden = false; };
      // Links remain usable when JavaScript is disabled. Install the fallback
      // before attempting navigation: Android browsers may block auto-launch.
      fallback.hidden = true;
      const timer = setTimeout(showFallback, 1800);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') clearTimeout(timer);
        else showFallback();
      });
      window.addEventListener('pagehide', () => clearTimeout(timer));
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) showFallback();
      });
      try { window.location.assign(openApp.href); }
      catch { /* The timed fallback handles browsers that block intents. */ }
    })();
  </script>
</body>
</html>`);
};
