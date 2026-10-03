import { runInNewContext } from 'node:vm';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { androidCheckoutReturn } from '../src/topup/android-checkout-return.js';

const token = `a_-${'B'.repeat(40)}`;
const encoded = encodeURIComponent(token);
const intent = `intent://checkout-return?checkoutResumeToken=${encoded}#Intent;scheme=flupflap;package=com.ticash.flupflap;end`;
const website = `https://www.flupflap.com/?checkoutResumeToken=${encoded}`;
const app = express().get('/return', androidCheckoutReturn);
const render = () => request(app).get('/return').query({ checkoutResumeToken: token }).expect(200);

function browser(html: string, blocked = false) {
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!;
  const fallback = { hidden: false };
  const documentEvents: Record<string, () => void> = {};
  const windowEvents: Record<string, (event: { persisted?: boolean }) => void> = {};
  const assign = vi.fn(() => { if (blocked) throw new Error('User gesture required'); });
  const setTimeout = vi.fn<(callback: () => void, delay: number) => number>().mockReturnValue(1);
  const clearTimeout = vi.fn();
  const document = {
    visibilityState: 'visible',
    getElementById: (id: string) => id === 'fallback' ? fallback : { href: intent },
    addEventListener: (name: string, callback: () => void) => { documentEvents[name] = callback; },
  };
  runInNewContext(script, {
    document,
    window: {
      location: { assign },
      addEventListener: (name: string, callback: (event: { persisted?: boolean }) => void) => { windowEvents[name] = callback; },
    },
    setTimeout,
    clearTimeout,
  });
  return { fallback, document, documentEvents, windowEvents, assign, setTimeout, clearTimeout };
}

describe('Android checkout return page', () => {
  it('renders branded, accessible mobile content with encoded first-party return links only', async () => {
    const page = await render();
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('<title>Returning to FlupFlap</title>');
    expect(page.text).toContain('<p class="wordmark">FlupFlap</p>');
    expect(page.text).toContain("We're securely checking your payment and recharge status.");
    expect(page.text).toContain('width=device-width,initial-scale=1');
    expect(page.text).toContain('prefers-reduced-motion');
    expect(page.text).toContain('class="spinner"');
    expect(page.text.match(/href="([^"]+)"/g)).toEqual([`href="${intent}"`, `href="${website}"`]);
    expect(page.text).toContain('>Open FlupFlap App</a>');
    expect(page.text).toContain('>Continue on Website</a>');
    // The capability must not appear in visible copy or be interpolated into JS.
    const visible = page.text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, '');
    expect(visible).not.toContain(token);
    expect(visible).not.toContain('checkoutResumeToken');
    expect(page.text).not.toMatch(/success|payment[- ]confirmed|payment complete|recharge complete|paid successfully/i);
    expect(page.text).not.toMatch(/<script[^>]+src=|<iframe|<form|fetch\(|XMLHttpRequest|sendBeacon|localStorage|accessToken|authToken/i);
    // Progressive enhancement: manual links are available with JS disabled.
    expect(page.text).toContain('<div id="fallback" class="actions">');
  });

  it('allows only per-response nonce scripts/styles and preserves private response headers', async () => {
    const first = await render();
    const second = await render();
    const nonce = first.text.match(/<script nonce="([^"]+)"/)![1]!;
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['referrer-policy']).toBe('no-referrer');
    expect(first.headers['content-security-policy']).toBe(`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    expect(first.text).toContain(`<style nonce="${nonce}">`);
    expect(second.text).not.toContain(nonce);
  });

  it.each([false, true])('attempts the secure intent immediately and reveals fallback after 1.8s (blocked: %s)', async (blocked) => {
    const b = browser((await render()).text, blocked);
    expect(b.assign).toHaveBeenCalledExactlyOnceWith(intent);
    expect(b.fallback.hidden).toBe(true);
    expect(b.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1800);
    expect(b.setTimeout.mock.invocationCallOrder[0]).toBeLessThan(b.assign.mock.invocationCallOrder[0]!);
    b.setTimeout.mock.calls[0]![0]();
    expect(b.fallback.hidden).toBe(false);
    expect(b.assign).toHaveBeenCalledTimes(1);
  });

  it('stops the fallback timer when the app opens and restores links when returning to the browser', async () => {
    const b = browser((await render()).text);
    b.document.visibilityState = 'hidden';
    b.documentEvents.visibilitychange!();
    expect(b.clearTimeout).toHaveBeenCalledWith(1);
    b.document.visibilityState = 'visible';
    b.documentEvents.visibilitychange!();
    expect(b.fallback.hidden).toBe(false);
    b.windowEvents.pagehide!({});
    b.fallback.hidden = true;
    b.windowEvents.pageshow!({ persisted: true });
    expect(b.fallback.hidden).toBe(false);
    expect(b.assign).toHaveBeenCalledTimes(1);
  });

  it.each([
    '', '?checkoutResumeToken=', '?checkoutResumeToken=short',
    `?checkoutResumeToken=${'a'.repeat(513)}`,
    '?checkoutResumeToken=%3Cscript%3Ebad%3C%2Fscript%3E',
    `?checkoutResumeToken=${token}%22`,
    `?checkoutResumeToken=${token}&checkoutResumeToken=${token}`,
    `?checkoutResumeToken=${token}%0A`,
  ])('rejects invalid or missing capabilities without rendering HTML: %s', async (query) => {
    const page = await request(app).get(`/return${query}`).expect(400);
    expect(page.text).toBe('Invalid checkout return');
    expect(page.headers['content-type']).toContain('text/plain');
    expect(page.headers['content-security-policy']).not.toContain('script-src');
    expect(page.headers['cache-control']).toBe('no-store');
  });
});
