import { expect, it } from 'vitest';
import { customerPhoneCountry } from '../src/flupflap/customer-country.js';
import { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';

it.each([
  ['+18298691951', 'DO'], ['+18095551234', 'DO'], ['+17755287791', 'US'],
  ['+14165551234', 'CA'], ['+50933552535', 'HT'], ['+33612345678', 'FR'],
  ['+5097050210', null], ['+18005551234', null], ['8298691951', null], [null, null],
])('classifies the client phone %s without assuming a shared calling code means US', (phone, country) => {
  expect(customerPhoneCountry(phone)).toBe(country);
});

it('records phone country separately from billing country for new identities', async () => {
  const repo = new FlupFlapIdentityRepository();
  const customer = await repo.create({ phone: '+18298691951', countryCode: 'HT' });
  expect(customer).toMatchObject({ countryCode: 'HT', phoneCountryCode: 'DO' });
  const guest = await repo.create({ guestExpiresAt: new Date(), countryCode: 'EG' });
  expect(guest).toMatchObject({ countryCode: 'EG', phoneCountryCode: null });
});
