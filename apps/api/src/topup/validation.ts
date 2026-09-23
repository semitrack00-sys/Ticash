import { z } from 'zod';
import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { MobileTopUpError } from './types.js';

export const topUpCountryCodeShape = z.string().trim().min(1).max(8);
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

export function normalizeTopUpPhone(value: string, countryCode: string): string {
  const normalizedCountry = normalizeTopUpCountryCode(countryCode);
  if (!isSupportedCountry(normalizedCountry)) {
    throw new MobileTopUpError(
      'INVALID_TOPUP_COUNTRY',
      'This destination country does not have supported phone metadata',
      400,
    );
  }

  const compact = value.trim().replace(/[\s().-]/g, '');
  if (!compact) {
    throw new MobileTopUpError(
      'INVALID_TOPUP_PHONE',
      'Enter a valid mobile number',
      400,
    );
  }

  const candidate = /^00\d+$/.test(compact)
    ? `+${compact.slice(2)}`
    : compact;

  if (!/^\+?\d+$/.test(candidate)) {
    throw new MobileTopUpError(
      'INVALID_TOPUP_PHONE',
      'Enter a valid mobile number',
      400,
    );
  }

  const parsed = parsePhoneNumberFromString(
    candidate,
    normalizedCountry as CountryCode,
  );

  if (!parsed || !parsed.isPossible()) {
    throw new MobileTopUpError(
      'INVALID_TOPUP_PHONE',
      'Enter a valid mobile number for the selected destination country',
      400,
    );
  }

  if (parsed.country !== normalizedCountry) {
    throw new MobileTopUpError(
      'INVALID_TOPUP_PHONE',
      'The mobile number does not belong to the selected destination country',
      400,
    );
  }

  return parsed.number;
}