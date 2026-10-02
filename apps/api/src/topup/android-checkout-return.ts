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
  res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Return to FlupFlap</title><main><h1>Return to FlupFlap</h1><p>Your payment and recharge status will be checked securely. This page does not confirm payment.</p><p><a href="intent://checkout-return?checkoutResumeToken=${encoded}#Intent;scheme=flupflap;package=com.ticash.flupflap;end">Open FlupFlap app</a></p><p><a href="https://www.flupflap.com/?checkoutResumeToken=${encoded}">Continue on the website</a></p></main></html>`);
};
