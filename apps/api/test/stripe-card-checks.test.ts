import { describe, expect, it, vi } from 'vitest';
import { StripeHostedCheckoutProvider } from '../src/topup/stripe-provider.js';
import { createRechargeFraudGate, approveRechargeReview } from '../src/topup/fraud-gate.js';
import { MobileTopUpService } from '../src/topup/service.js';
import type { StripeConfig } from '../src/topup/stripe-config.js';

const config: StripeConfig = {
  enabled: true, environment: 'production', testMode: false,
  secretKey: 'sk_live_fixture_secret', publicKey: 'pk_live_fixture_public', webhookSecret: 'whsec_fixture_secret',
  successUrl: 'https://flupflap.com/recharge/success', failureUrl: 'https://flupflap.com/recharge/failure',
};
const customerId = '11111111-1111-4111-8111-111111111111';

function fixture(checks?: Record<string, unknown>) {
  const transport = vi.fn(async () => new Response(JSON.stringify({
    id: 'pi_fixture', status: 'succeeded', livemode: true, metadata: { transactionId: 'tx' },
    latest_charge: {
      id: 'ch_fixture', paid: true, captured: true, disputed: false, amount_refunded: 0,
      outcome: { risk_level: 'normal' }, payment_method_details: {
        type: 'card', card: { fingerprint: 'fixture-card', network: 'visa', electronic_commerce_indicator: '05',
          three_d_secure: { result: 'authenticated' }, checks },
      },
    },
  }), {status: 200}));
  return {stripe: new StripeHostedCheckoutProvider(config, transport), transport};
}

describe('issuer verification results from Stripe to fulfillment', () => {
  it.each([
    {address_postal_code_check:'fail', cvc_check:'pass'},
    {address_postal_code_check:'pass', cvc_check:'pass', address_line1_check:'fail'},
    {address_postal_code_check:'pass', cvc_check:'fail'},
    {address_postal_code_check:'unavailable', cvc_check:'pass'},
    {address_postal_code_check:'pass', cvc_check:'unchecked'},
    {address_postal_code_check:null, cvc_check:'pass'},
    {address_postal_code_check:'pass'},
    {},
  ])('persists a hold and never calls the supplier for %j', async checks => {
    const {stripe, transport} = fixture(checks);
    let record = {id:'tx', userId:`flupflap:${customerId}`, paymentProvider:'STRIPE', paymentProviderTransactionId:'pi_fixture',
      status:'PENDING', paymentStatus:'CAPTURED', testMode:false};
    const assessments = {findUnique:vi.fn().mockResolvedValue(null), findMany:vi.fn().mockResolvedValue([]), upsert:vi.fn()};
    const tx = { flupFlapDevice:{findMany:vi.fn().mockResolvedValue([])}, auditLog:{findMany:vi.fn().mockResolvedValue([]),create:vi.fn()},$queryRaw:vi.fn(), flupFlapCustomer:{findUnique:vi.fn().mockResolvedValue({status:'ACTIVE'})}, rechargeFraudAssessment:assessments};
    const db = {...tx, $transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)};
    const gate = createRechargeFraudGate(db as never, stripe);
    const submit = vi.fn(); const claim = vi.fn();
    const repo = {getTransactionById:async()=>record, claimOperation:claim,
      updateTransaction:async(_id:string,patch:object)=>record={...record,...patch}};
    const service = new MobileTopUpService({enabled:true} as never, {submitTopUp:submit} as never, {} as never,
      repo as never, async()=>{}, undefined, undefined, undefined, undefined, false, undefined, gate);
    vi.spyOn(service as never, 'assertTransactionEnvironment' as never).mockImplementation(()=>undefined);

    await service.fulfillPaidRecharge('tx');
    await service.fulfillPaidRecharge('tx');
    expect(record).toMatchObject({status:'PENDING', paymentStatus:'CAPTURED', failureCode:'FRAUD_REVIEW_REQUIRED', paymentRecoveryCode:(checks.address_line1_check === 'fail' ? 'PAYMENT_STREET_CHECK_FAILED' : 'PAYMENT_CARD_CHECK_FAILED')});
    expect(assessments.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({reason:(checks.address_line1_check === 'fail' ? 'PAYMENT_STREET_CHECK_FAILED' : 'PAYMENT_CARD_CHECK_FAILED')})}));
    expect(transport).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();

    // A fresh review reads the issuer checks again; it cannot override the failure.
    assessments.upsert.mockClear();
    await expect(approveRechargeReview(db as never, stripe, record as never, 'staff', 'Reviewed payment evidence'))
      .rejects.toMatchObject({code:'FRAUD_REVIEW_NOT_CLEAR'});
    expect(assessments.upsert).not.toHaveBeenCalled();
  });

  it('maps check results without assuming missing issuer checks passed', async () => {
    const {stripe} = fixture({address_postal_code_check:null, cvc_check:'unavailable'});
    expect(await stripe.fraudEvidence('pi_fixture', 'tx')).toMatchObject({postalCodeCheck:undefined, cvcCheck:'unavailable'});
    expect(await fixture().stripe.fraudEvidence('pi_fixture', 'tx')).toMatchObject({postalCodeCheck:undefined, cvcCheck:undefined});
  });
});
