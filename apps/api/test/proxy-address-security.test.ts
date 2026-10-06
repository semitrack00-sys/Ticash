import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const proxyAddress = createRequire(import.meta.url)('proxy-addr') as {
  compile(subnet: string): (address: string, index: number) => boolean;
};

describe('proxy trust subnet security', () => {
  it('does not trust arbitrary IPv4 clients through a short mapped-IPv6 prefix', () => {
    const trust = proxyAddress.compile('::ffff:10.0.0.0/8');
    expect(trust('203.0.113.7', 0)).toBe(false);
    expect(trust('192.0.2.12', 0)).toBe(false);
  });
  it('preserves a correctly encoded IPv4-mapped private trust subnet', () => {
    const trust = proxyAddress.compile('::ffff:10.0.0.0/104');
    expect(trust('10.2.3.4', 0)).toBe(true);
    expect(trust('203.0.113.7', 0)).toBe(false);
  });
});
