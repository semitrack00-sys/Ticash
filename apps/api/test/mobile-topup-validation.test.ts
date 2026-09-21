import { describe, expect, it } from 'vitest';
import {
  normalizeTopUpCountryCode,
  normalizeTopUpPhone,
} from '../src/topup/validation.js';

describe('mobile top-up validation helpers', () => {
  it('normalizes supported country codes', () => {
    expect(normalizeTopUpCountryCode('jm')).toBe('JM');
    expect(normalizeTopUpCountryCode(' HT ')).toBe('HT');
  });

  it('keeps Haiti local numbers working while normalizing formatting', () => {
    expect(normalizeTopUpPhone('3712-3456', 'HT')).toBe('+50937123456');
    expect(normalizeTopUpPhone('+509 37 12 34 56', 'HT')).toBe('+50937123456');
  });

  it('requires international numbers when safe country-specific normalization is unavailable', () => {
    expect(normalizeTopUpPhone('00 1 876 555 1234', 'JM')).toBe('+18765551234');
    expect(() => normalizeTopUpPhone('8765551234', 'JM')).toThrow(/international mobile number/i);
    expect(() => normalizeTopUpCountryCode('1')).toThrow(/destination country code/i);
  });
});
