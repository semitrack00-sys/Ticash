import { z } from 'zod';
import { MobileTopUpError } from './types.js';

export const topUpCountryCodeShape = z.string().trim().min(2).max(8);
export const topUpPhoneShape = z.string().trim().min(4).max(40);

export function normalizeTopUpCountryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new MobileTopUpError(
      'INVALID_TOPUP_COUNTRY',
      'Enter a valid two-letter destination country code',
      400,
    );
  }
  return normalized;
}

function normalizeGenericInternationalPhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (!compact) {
    throw new MobileTopUpError(
      'INVALID_TOPUP_PHONE',
      'Enter a valid international mobile number',
      400,
    );
  }

  let normalized = compact;
  if (/^00\d+$/.test(normalized)) normalized = `+${normalized.slice(2)}`;
  if (!/^\+\d+$/.test(normalized)) {
    throw new MobileTopUpError(
      'INVALID_TOPUP_PHONE',
      'Enter a valid international mobile number with a country prefix',
      400,
    );
  }
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new MobileTopUpError(
      'INVALID_TOPUP_PHONE',
      'Enter a valid international mobile number',
      400,
    );
  }
  return normalized;
}

export function normalizeTopUpPhone(value: string, countryCode: string): string {
  const normalizedCountry = normalizeTopUpCountryCode(countryCode);
  const compact = value.trim().replace(/[\s().-]/g, '');

  if (normalizedCountry === 'HT' && /^\+?\d+$/.test(compact)) {
    const digits = compact.replace(/^\+/, '');
    const localDigits = digits.startsWith('509') ? digits.slice(3) : digits;
    if (/^\d{8}$/.test(localDigits)) {
      return `+509${localDigits}`;
    }
  }

  return normalizeGenericInternationalPhone(value);
}
