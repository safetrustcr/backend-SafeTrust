import { Keypair } from '@stellar/stellar-sdk';
import {
  PendingPaymentSettlementError,
  SpendingLedger,
  SpendingLimitError,
  createPaymentFetch,
  getDefaultUsdcContract,
  getPaymentRecordForResponse,
  getPendingReservationForResponse,
  loadSpendingConfigFromEnv,
  type AgentSpendingConfig,
} from '../payments';

const PLATFORM_WALLET =
  'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const ATTACKER_WALLET =
  'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const TESTNET_USDC = getDefaultUsdcContract('testnet');

function makeConfig(
  overrides: Partial<AgentSpendingConfig> = {}
): AgentSpendingConfig {
  return {
    maxFeePerCallUsdc: 0.1,
    feeBudgetUsdc: 0.5,
    maxDepositUsdc: 50.0,
    network: 'testnet',
    expectedPayTo: PLATFORM_WALLET,
    expectedAssetContract: TESTNET_USDC,
    ...overrides,
  };
}

describe('SpendingLedger & configuration', () => {
  it('loads testnet defaults from env when variables are unset', () => {
    const cfg = loadSpendingConfigFromEnv({});
    expect(cfg.network).toBe('testnet');
    expect(cfg.maxFeePerCallUsdc).toBe(0.1);
    expect(cfg.feeBudgetUsdc).toBe(0.5);
    expect(cfg.maxDepositUsdc).toBe(50.0);
    expect(cfg.expectedAssetContract).toBe(TESTNET_USDC);
  });

  it('reads custom limits from env variables', () => {
    const cfg = loadSpendingConfigFromEnv({
      AGENT_MAX_FEE_PER_CALL: '0.25',
      AGENT_FEE_BUDGET: '1.50',
      AGENT_MAX_DEPOSIT: '100',
      STELLAR_NETWORK: 'mainnet',
      SAFETRUST_PLATFORM_WALLET: PLATFORM_WALLET,
    });
    expect(cfg.network).toBe('mainnet');
    expect(cfg.maxFeePerCallUsdc).toBe(0.25);
    expect(cfg.feeBudgetUsdc).toBe(1.5);
    expect(cfg.maxDepositUsdc).toBe(100);
    expect(cfg.expectedAssetContract).toBe(getDefaultUsdcContract('mainnet'));
  });

  it('gives uppercase AGENT_MAX_DEPOSIT precedence over mixed-case AGENT_MAX_deposit', () => {
    const cfg = loadSpendingConfigFromEnv({
      AGENT_MAX_deposit: '',
      AGENT_MAX_DEPOSIT: '10',
    });
    expect(cfg.maxDepositUsdc).toBe(10);

    const fallbackCfg = loadSpendingConfigFromEnv({
      AGENT_MAX_deposit: '25',
    });
    expect(fallbackCfg.maxDepositUsdc).toBe(25);
  });

  it('refuses a 402 requirement when fee exceeds AGENT_MAX_FEE_PER_CALL', () => {
    const ledger = new SpendingLedger(makeConfig({ maxFeePerCallUsdc: 0.1 }));
    expect(() =>
      ledger.verifyBeforePay({
        scheme: 'exact',
        network: 'stellar:testnet',
        max_amount_usdc: 0.15,
        asset: { code: 'USDC', contract: TESTNET_USDC },
        pay_to: PLATFORM_WALLET,
      })
    ).toThrow(SpendingLimitError);

    try {
      ledger.verifyBeforePay({
        scheme: 'exact',
        network: 'stellar:testnet',
        max_amount_usdc: 0.15,
        asset: { code: 'USDC', contract: TESTNET_USDC },
        pay_to: PLATFORM_WALLET,
      });
    } catch (err) {
      expect((err as SpendingLimitError).code).toBe('FEE_PER_CALL_EXCEEDED');
    }
  });

  it('refuses paid calls once session AGENT_FEE_BUDGET is reached', () => {
    const ledger = new SpendingLedger(
      makeConfig({ maxFeePerCallUsdc: 0.25, feeBudgetUsdc: 0.3 })
    );

    const req = ledger.verifyBeforePay({
      scheme: 'exact',
      network: 'stellar:testnet',
      max_amount_usdc: 0.2,
      asset: { code: 'USDC', contract: TESTNET_USDC },
      pay_to: PLATFORM_WALLET,
    });
    ledger.recordFeePayment(req, '/api/v1/bookings');

    expect(ledger.getFeesSpentUsdc()).toBe(0.2);
    expect(ledger.getRemainingFeeBudgetUsdc()).toBe(0.1);

    expect(() =>
      ledger.verifyBeforePay({
        scheme: 'exact',
        network: 'stellar:testnet',
        max_amount_usdc: 0.15,
        asset: { code: 'USDC', contract: TESTNET_USDC },
        pay_to: PLATFORM_WALLET,
      })
    ).toThrow(SpendingLimitError);
  });

  it('refuses a payTo address that differs from configured SafeTrust wallet', () => {
    const ledger = new SpendingLedger(makeConfig());
    try {
      ledger.verifyBeforePay({
        scheme: 'exact',
        network: 'stellar:testnet',
        max_amount_usdc: 0.05,
        asset: { code: 'USDC', contract: TESTNET_USDC },
        pay_to: ATTACKER_WALLET,
      });
      fail('Expected UNTRUSTED_PAY_TO error');
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingLimitError);
      expect((err as SpendingLimitError).code).toBe('UNTRUSTED_PAY_TO');
    }
  });

  it('refuses a network that differs from configured STELLAR_NETWORK', () => {
    const ledger = new SpendingLedger(makeConfig({ network: 'testnet' }));
    try {
      ledger.verifyBeforePay({
        scheme: 'exact',
        network: 'stellar:mainnet',
        max_amount_usdc: 0.05,
        asset: { code: 'USDC', contract: getDefaultUsdcContract('mainnet') },
        pay_to: PLATFORM_WALLET,
      });
      fail('Expected NETWORK_MISMATCH error');
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingLimitError);
      expect((err as SpendingLimitError).code).toBe('NETWORK_MISMATCH');
    }
  });

  it('refuses an asset contract that differs from configured USDC', () => {
    const ledger = new SpendingLedger(makeConfig());
    try {
      ledger.verifyBeforePay({
        scheme: 'exact',
        network: 'stellar:testnet',
        max_amount_usdc: 0.05,
        asset: { code: 'USDC', contract: 'CFAKEASSETCONTRACT' },
        pay_to: PLATFORM_WALLET,
      });
      fail('Expected ASSET_MISMATCH error');
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingLimitError);
      expect((err as SpendingLimitError).code).toBe('ASSET_MISMATCH');
    }
  });

  it('refuses deposits exceeding AGENT_MAX_DEPOSIT', () => {
    const ledger = new SpendingLedger(makeConfig({ maxDepositUsdc: 50 }));
    expect(() => ledger.verifyDepositLimit(50)).not.toThrow();
    try {
      ledger.verifyDepositLimit(50.01);
      fail('Expected DEPOSIT_LIMIT_EXCEEDED');
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingLimitError);
      expect((err as SpendingLimitError).code).toBe('DEPOSIT_LIMIT_EXCEEDED');
    }
  });

  it('formats spending_summary accurately', () => {
    const ledger = new SpendingLedger(makeConfig());
    const r1 = ledger.verifyBeforePay({
      scheme: 'exact',
      network: 'stellar:testnet',
      max_amount_usdc: 0.01,
      asset: { code: 'USDC', contract: TESTNET_USDC },
      pay_to: PLATFORM_WALLET,
    });
    ledger.recordFeePayment(r1, '/api/v1/holds');
    const r2 = ledger.verifyBeforePay({
      scheme: 'exact',
      network: 'stellar:testnet',
      max_amount_usdc: 0.1,
      asset: { code: 'USDC', contract: TESTNET_USDC },
      pay_to: PLATFORM_WALLET,
    });
    ledger.recordFeePayment(r2, '/api/v1/bookings');
    ledger.recordDeposit({
      bookingId: 'b1',
      contractId: 'C123',
      amountUsdc: 45,
    });

    const summary = ledger.getSummary();
    expect(summary.feesSpentUsdc).toBe(0.11);
    expect(summary.depositsLockedUsdc).toBe(45);
    expect(summary.formatted).toBe(
      'Fees 0.11 / 0.50 USDC · Deposit 45.00 / 50.00 USDC'
    );
  });
});

describe('createPaymentFetch (@x402/fetch integration)', () => {
  it('pays 402 automatically when within limits and records fee in ledger', async () => {
    const ledger = new SpendingLedger(makeConfig());
    const kp = Keypair.random();
    const createPaymentPayload = jest.fn(async (x402Version: number) => ({
      x402Version,
      payload: { transaction: 'signed_x402_payload' },
    }));

    const baseFetch: typeof globalThis.fetch = jest.fn(async (input) => {
      const req = input as Request;
      if (req.headers.has('PAYMENT-SIGNATURE')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          error: 'Payment Required',
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'stellar:testnet',
              max_amount_usdc: 0.01,
              asset: { code: 'USDC', contract: TESTNET_USDC },
              pay_to: PLATFORM_WALLET,
              facilitator_url: 'https://channels.openzeppelin.com/x402/testnet',
            },
          ],
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const payFetch = createPaymentFetch({
      baseFetch,
      ledger,
      signerOrSecret: kp.secret(),
      schemeClient: {
        scheme: 'exact',
        createPaymentPayload,
      },
    });

    const res = await payFetch('https://api.safetrust.local/api/v1/holds', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(createPaymentPayload).toHaveBeenCalledTimes(1);
    expect(ledger.getFeesSpentUsdc()).toBe(0.01);
    expect(getPaymentRecordForResponse(res)?.amountUsdc).toBe(0.01);
  });

  it('populates and validates the legacy SafeTrust X-Payment header separately', async () => {
    const ledger = new SpendingLedger(makeConfig());
    const kp = Keypair.random();
    const expectedFacilitator = 'https://channels.openzeppelin.com/x402/testnet';
    const expectedTx = 'signed_legacy_x402_tx';

    const baseFetch: typeof globalThis.fetch = jest.fn(async (input) => {
      const req = input as Request;
      const xPayment = req.headers.get('X-Payment');
      if (xPayment) {
        expect(xPayment.startsWith('x402 ')).toBe(true);
        const decoded = JSON.parse(
          Buffer.from(xPayment.slice('x402 '.length), 'base64').toString('utf8')
        ) as {
          scheme: string;
          network: string;
          payload: string;
          amount: number;
          facilitatorUrl: string;
        };
        expect(decoded.scheme).toBe('exact');
        expect(decoded.network).toBe('stellar:testnet');
        expect(decoded.payload).toBe(expectedTx);
        expect(decoded.amount).toBe(0.01);
        expect(decoded.facilitatorUrl).toBe(expectedFacilitator);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          error: 'Payment Required',
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'stellar:testnet',
              max_amount_usdc: 0.01,
              asset: { code: 'USDC', contract: TESTNET_USDC },
              pay_to: PLATFORM_WALLET,
              facilitator_url: expectedFacilitator,
            },
          ],
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const payFetch = createPaymentFetch({
      baseFetch,
      ledger,
      signerOrSecret: kp.secret(),
      schemeClient: {
        scheme: 'exact',
        createPaymentPayload: async (x402Version: number) => ({
          x402Version,
          payload: { transaction: expectedTx },
        }),
      },
    });

    const res = await payFetch('https://api.safetrust.local/api/v1/holds', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(ledger.getFeesSpentUsdc()).toBe(0.01);
  });

  it('reads PAYMENT-REQUIRED header even when 402 body is plain text', async () => {
    const ledger = new SpendingLedger(makeConfig());
    const kp = Keypair.random();
    const encodedHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: 'stellar:testnet',
            amount: '100000',
            asset: TESTNET_USDC,
            payTo: PLATFORM_WALLET,
          },
        ],
      }),
      'utf8'
    ).toString('base64');

    const baseFetch: typeof globalThis.fetch = jest.fn(async (input) => {
      const req = input as Request;
      if (req.headers.has('PAYMENT-SIGNATURE')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('Payment Required', {
        status: 402,
        headers: {
          'Content-Type': 'text/plain',
          'PAYMENT-REQUIRED': encodedHeader,
        },
      });
    });

    const payFetch = createPaymentFetch({
      baseFetch,
      ledger,
      signerOrSecret: kp.secret(),
      schemeClient: {
        scheme: 'exact',
        createPaymentPayload: async (x402Version: number) => ({
          x402Version,
          payload: { transaction: 'signed_header_only_tx' },
        }),
      },
    });

    const res = await payFetch('https://api.safetrust.local/api/v1/holds', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(ledger.getFeesSpentUsdc()).toBe(0.01);
  });

  it('enforces budget across overlapping paid calls and only sends one paid retry', async () => {
    const ledger = new SpendingLedger(
      makeConfig({ maxFeePerCallUsdc: 0.1, feeBudgetUsdc: 0.12 })
    );
    const kp = Keypair.random();
    let paidRetryCount = 0;

    const baseFetch: typeof globalThis.fetch = jest.fn(async (input) => {
      const req = input as Request;
      const isCallA = req.url.includes('/call-a');
      if (req.headers.has('PAYMENT-SIGNATURE')) {
        paidRetryCount += 1;
        // Delay call A so call B overlaps
        await new Promise((r) => setTimeout(r, isCallA ? 30 : 5));
        return new Response(JSON.stringify({ call: isCallA ? 'a' : 'b' }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'stellar:testnet',
              max_amount_usdc: 0.08,
              asset: { code: 'USDC', contract: TESTNET_USDC },
              pay_to: PLATFORM_WALLET,
              facilitator_url: isCallA
                ? 'https://fac.a.local'
                : 'https://fac.b.local',
            },
          ],
        }),
        { status: 402 }
      );
    });

    const payFetch = createPaymentFetch({
      baseFetch,
      ledger,
      signerOrSecret: kp.secret(),
      schemeClient: {
        scheme: 'exact',
        createPaymentPayload: async (x402Version: number) => ({
          x402Version,
          payload: { transaction: 'signed_tx' },
        }),
      },
    });

    const results = await Promise.allSettled([
      payFetch('https://api.safetrust.local/call-a', { method: 'POST' }),
      payFetch('https://api.safetrust.local/call-b', { method: 'POST' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(SpendingLimitError);
    expect((rejected[0].reason as SpendingLimitError).code).toBe(
      'FEE_BUDGET_EXCEEDED'
    );
    expect(paidRetryCount).toBe(1);
    expect(ledger.getFeesSpentUsdc()).toBe(0.08);
    expect(ledger.getFeesReservedUsdc()).toBe(0);
  });

  it('isolates facilitator URLs and per-response payment records across concurrent paid calls', async () => {
    const ledger = new SpendingLedger(
      makeConfig({ maxFeePerCallUsdc: 0.1, feeBudgetUsdc: 0.25 })
    );
    const kp = Keypair.random();
    const seenFacilitators = new Map<string, string>();

    const baseFetch: typeof globalThis.fetch = jest.fn(async (input) => {
      const req = input as Request;
      const isCallA = req.url.includes('/call-a');
      if (req.headers.has('PAYMENT-SIGNATURE')) {
        await new Promise((r) => setTimeout(r, isCallA ? 30 : 5));
        const xPay = req.headers.get('X-Payment')!;
        const decoded = JSON.parse(
          Buffer.from(xPay.slice('x402 '.length), 'base64').toString('utf8')
        ) as { facilitatorUrl: string };
        seenFacilitators.set(isCallA ? 'a' : 'b', decoded.facilitatorUrl);
        return new Response(JSON.stringify({ call: isCallA ? 'a' : 'b' }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'stellar:testnet',
              max_amount_usdc: isCallA ? 0.08 : 0.05,
              asset: { code: 'USDC', contract: TESTNET_USDC },
              pay_to: PLATFORM_WALLET,
              facilitator_url: isCallA
                ? 'https://fac.a.local'
                : 'https://fac.b.local',
            },
          ],
        }),
        { status: 402 }
      );
    });

    const payFetch = createPaymentFetch({
      baseFetch,
      ledger,
      signerOrSecret: kp.secret(),
      schemeClient: {
        scheme: 'exact',
        createPaymentPayload: async (x402Version: number) => ({
          x402Version,
          payload: { transaction: 'signed_tx' },
        }),
      },
    });

    const [resA, resB] = await Promise.all([
      payFetch('https://api.safetrust.local/call-a', { method: 'POST' }),
      payFetch('https://api.safetrust.local/call-b', { method: 'POST' }),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(seenFacilitators.get('a')).toBe('https://fac.a.local');
    expect(seenFacilitators.get('b')).toBe('https://fac.b.local');
    expect(getPaymentRecordForResponse(resA)?.amountUsdc).toBe(0.08);
    expect(getPaymentRecordForResponse(resB)?.amountUsdc).toBe(0.05);
    expect(ledger.getFeesSpentUsdc()).toBe(0.13);
    expect(ledger.getFeesReservedUsdc()).toBe(0);
  });

  it('parses PAYMENT-RESPONSE on 402 rejections and reconciles pending reservations in-session', async () => {
    const ledger = new SpendingLedger(
      makeConfig({ maxFeePerCallUsdc: 0.1, feeBudgetUsdc: 0.1 })
    );
    const kp = Keypair.random();
    let mode:
      | 'v2RejectNoTx'
      | 'v2MalformedHeader'
      | 'v2RejectWithTx'
      | 'networkFail'
      | 'succeed' = 'v2RejectNoTx';

    const baseFetch: typeof globalThis.fetch = jest.fn(async (input) => {
      const req = input as Request;
      if (req.headers.has('PAYMENT-SIGNATURE')) {
        if (mode === 'v2RejectNoTx') {
          const header = Buffer.from(
            JSON.stringify({
              success: false,
              errorReason: 'insufficient_funds',
            }),
            'utf8'
          ).toString('base64');
          return new Response(JSON.stringify({ error: 'Insufficient funds' }), {
            status: 402,
            headers: { 'PAYMENT-RESPONSE': header },
          });
        }
        if (mode === 'v2MalformedHeader') {
          return new Response(JSON.stringify({ error: 'Malformed' }), {
            status: 402,
            headers: { 'PAYMENT-RESPONSE': 'not-valid-base64-json!!!' },
          });
        }
        if (mode === 'v2RejectWithTx') {
          const header = Buffer.from(
            JSON.stringify({
              success: false,
              transaction: 'tx_ambiguous_123',
            }),
            'utf8'
          ).toString('base64');
          return new Response(JSON.stringify({ error: 'Ambiguous' }), {
            status: 402,
            headers: { 'PAYMENT-RESPONSE': header },
          });
        }
        if (mode === 'networkFail') {
          throw new Error('socket hang up');
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'stellar:testnet',
              max_amount_usdc: 0.1,
              asset: { code: 'USDC', contract: TESTNET_USDC },
              pay_to: PLATFORM_WALLET,
            },
          ],
        }),
        { status: 402 }
      );
    });

    const payFetch = createPaymentFetch({
      baseFetch,
      ledger,
      signerOrSecret: kp.secret(),
      schemeClient: {
        scheme: 'exact',
        createPaymentPayload: async (x402Version: number) => ({
          x402Version,
          payload: { transaction: 'signed_x402_ref_abc' },
        }),
      },
    });

    // 1. x402 v2 confirmed no-settlement (success: false, no transaction) -> released immediately
    const res1 = await payFetch('https://api.safetrust.local/api/v1/holds', {
      method: 'POST',
    });
    expect(res1.status).toBe(402);
    expect(ledger.getFeesReservedUsdc()).toBe(0);
    expect(ledger.getRemainingFeeBudgetUsdc()).toBe(0.1);

    // 2. Malformed PAYMENT-RESPONSE -> kept pending, exposed on Response, can reconcile to released
    mode = 'v2MalformedHeader';
    const res2 = await payFetch('https://api.safetrust.local/api/v1/holds', {
      method: 'POST',
    });
    expect(res2.status).toBe(402);
    expect(ledger.getFeesReservedUsdc()).toBe(0.1);
    const pendingRes2 = getPendingReservationForResponse(res2);
    expect(pendingRes2?.id).toBeTruthy();
    const recUnknown = await ledger.reconcileFeeReservation(
      pendingRes2!.id,
      async () => 'unknown' as const
    );
    expect(recUnknown.status).toBe('pending');
    expect(ledger.getFeesReservedUsdc()).toBe(0.1);

    const recReleased = await ledger.reconcileFeeReservation(
      pendingRes2!.id,
      async () => 'not_settled' as const
    );
    expect(recReleased.status).toBe('released');
    expect(ledger.getFeesReservedUsdc()).toBe(0);
    expect(ledger.getRemainingFeeBudgetUsdc()).toBe(0.1);

    // 2b. PAYMENT-RESPONSE with success: false AND a nonempty transaction -> kept pending & exposes reservation ID
    mode = 'v2RejectWithTx';
    const res2b = await payFetch('https://api.safetrust.local/api/v1/holds', {
      method: 'POST',
    });
    expect(res2b.status).toBe(402);
    expect(ledger.getFeesReservedUsdc()).toBe(0.1);
    const pendingRes2b = getPendingReservationForResponse(res2b);
    expect(pendingRes2b?.id).toBeTruthy();
    const rec2bReleased = await ledger.reconcileFeeReservation(
      pendingRes2b!.id,
      async () => 'not_settled' as const
    );
    expect(rec2bReleased.status).toBe('released');
    expect(ledger.getFeesReservedUsdc()).toBe(0);

    // 3. Transport failure after retry sent -> throws PendingPaymentSettlementError with reservationId only (no signed payload leak)
    mode = 'networkFail';
    let caughtErr: unknown;
    try {
      await payFetch('https://api.safetrust.local/api/v1/holds', {
        method: 'POST',
      });
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeInstanceOf(PendingPaymentSettlementError);
    const pendingErr = caughtErr as PendingPaymentSettlementError;
    expect(pendingErr.reservationId).toBeTruthy();
    expect(pendingErr.message).not.toContain('signed_x402_ref_abc');
    expect(ledger.getFeesReservedUsdc()).toBe(0.1);

    // Reconcile as settled -> commits reservation into feesSpentUsdc
    const recSettled = await ledger.reconcileFeeReservation(
      pendingErr.reservationId,
      async () => 'settled' as const
    );
    expect(recSettled.status).toBe('settled');
    expect(ledger.getFeesReservedUsdc()).toBe(0);
    expect(ledger.getFeesSpentUsdc()).toBe(0.1);
  });

  it('excludes active in-flight reservations from recovery, handles concurrent reconciliation, and parses exact decimal deposit cap strings', async () => {
    // 1. Exact decimal string cap parsing without Number() round-trip
    const cfgTrunc = loadSpendingConfigFromEnv({
      STELLAR_NETWORK: 'testnet',
      AGENT_MAX_DEPOSIT: '45.000000099999999',
    });
    const ledgerTrunc = new SpendingLedger(cfgTrunc);
    expect(() => ledgerTrunc.verifyDepositLimit(45.0)).not.toThrow();
    expect(() => ledgerTrunc.verifyDepositLimit(45.0000001)).toThrow(
      /AGENT_MAX_DEPOSIT/
    );

    const cfgExact = loadSpendingConfigFromEnv({
      STELLAR_NETWORK: 'testnet',
      AGENT_MAX_DEPOSIT: '45.0000001',
    });
    const ledgerExact = new SpendingLedger(cfgExact);
    expect(() => ledgerExact.verifyDepositLimit(45.0000001)).not.toThrow();

    // 2. Active in-flight reservation is counted against budget but excluded from external reconciliation
    const ledger = new SpendingLedger(
      makeConfig({ maxFeePerCallUsdc: 0.1, feeBudgetUsdc: 0.1 })
    );
    const active = ledger.reserveFeePayment(
      {
        scheme: 'exact',
        network: 'stellar:testnet',
        max_amount_usdc: 0.1,
        asset: { code: 'USDC', contract: TESTNET_USDC },
        pay_to: PLATFORM_WALLET,
      },
      '/api/v1/holds'
    );
    expect(ledger.getFeesReservedUsdc()).toBe(0.1);
    expect(ledger.getPendingFeeReservations()).toHaveLength(0);
    await expect(
      ledger.reconcileFeeReservation(active.id, async () => 'not_settled' as const)
    ).rejects.toThrow(/active in-flight/i);

    // 3. Once marked reconcilable, concurrent terminal resolution during await is returned instead of stale 'pending'
    ledger.markFeeReservationPendingReconciliation(active.id);
    expect(ledger.getPendingFeeReservations()).toHaveLength(1);
    const result = await ledger.reconcileFeeReservation(active.id, async () => {
      // Simulate another call committing the reservation while this resolver awaits
      ledger.commitFeeReservation(active.id);
      return 'unknown' as const;
    });
    expect(result.status).toBe('settled');
    expect(result.reservation.status).toBe('settled');
    expect(result.paidCall?.id).toBe(active.id);
  });

  it('releases fee reservation on definitive 402 rejection and preserves it on transport failure', async () => {
    const ledger = new SpendingLedger(
      makeConfig({ maxFeePerCallUsdc: 0.1, feeBudgetUsdc: 0.1 })
    );
    const kp = Keypair.random();
    let mode: 'reject402' | 'networkFail' | 'succeed' = 'reject402';

    const baseFetch: typeof globalThis.fetch = jest.fn(async (input) => {
      const req = input as Request;
      if (req.headers.has('PAYMENT-SIGNATURE')) {
        if (mode === 'reject402') {
          return new Response(JSON.stringify({ error: 'Rejected' }), {
            status: 402,
          });
        }
        if (mode === 'networkFail') {
          throw new Error('socket hang up');
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'stellar:testnet',
              max_amount_usdc: 0.1,
              asset: { code: 'USDC', contract: TESTNET_USDC },
              pay_to: PLATFORM_WALLET,
            },
          ],
        }),
        { status: 402 }
      );
    });

    const payFetch = createPaymentFetch({
      baseFetch,
      ledger,
      signerOrSecret: kp.secret(),
      schemeClient: {
        scheme: 'exact',
        createPaymentPayload: async (x402Version: number) => ({
          x402Version,
          payload: { transaction: 'signed_tx' },
        }),
      },
    });

    // 1. Definitive 402 rejection -> reservation released, full budget still available
    const rejectedRes = await payFetch('https://api.safetrust.local/api/v1/holds', {
      method: 'POST',
    });
    expect(rejectedRes.status).toBe(402);
    expect(ledger.getFeesSpentUsdc()).toBe(0);
    expect(ledger.getFeesReservedUsdc()).toBe(0);
    expect(ledger.getRemainingFeeBudgetUsdc()).toBe(0.1);

    // 2. Network/timeout failure after retry sent -> reservation remains pending
    mode = 'networkFail';
    await expect(
      payFetch('https://api.safetrust.local/api/v1/holds', { method: 'POST' })
    ).rejects.toThrow(/socket hang up/i);
    expect(ledger.getFeesSpentUsdc()).toBe(0);
    expect(ledger.getFeesReservedUsdc()).toBe(0.1);
    expect(ledger.getRemainingFeeBudgetUsdc()).toBe(0);

    // 3. Subsequent call cannot overspend budget while uncertain reservation is pending
    mode = 'succeed';
    await expect(
      payFetch('https://api.safetrust.local/api/v1/holds', { method: 'POST' })
    ).rejects.toThrow(/AGENT_FEE_BUDGET/i);
  });

  it('refuses BEFORE signing when server returns untrusted payTo', async () => {
    const ledger = new SpendingLedger(makeConfig());
    const kp = Keypair.random();
    const createPaymentPayload = jest.fn();

    const baseFetch: typeof globalThis.fetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          error: 'Payment Required',
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'stellar:testnet',
              max_amount_usdc: 0.01,
              asset: { code: 'USDC', contract: TESTNET_USDC },
              pay_to: ATTACKER_WALLET,
            },
          ],
        }),
        { status: 402 }
      );
    });

    const payFetch = createPaymentFetch({
      baseFetch,
      ledger,
      signerOrSecret: kp.secret(),
      schemeClient: {
        scheme: 'exact',
        createPaymentPayload,
      },
    });

    await expect(
      payFetch('https://api.safetrust.local/api/v1/holds', { method: 'POST' })
    ).rejects.toThrow(/payTo/i);
    expect(createPaymentPayload).not.toHaveBeenCalled();
    expect(ledger.getFeesSpentUsdc()).toBe(0);
  });
});
