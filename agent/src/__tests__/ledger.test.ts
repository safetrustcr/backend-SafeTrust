import { Keypair } from '@stellar/stellar-sdk';
import {
  SpendingLedger,
  SpendingLimitError,
  createPaymentFetch,
  getDefaultUsdcContract,
  getPaymentRecordForResponse,
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

  it('enforces budget and isolates state across concurrent paid calls', async () => {
    const ledger = new SpendingLedger(
      makeConfig({ maxFeePerCallUsdc: 0.1, feeBudgetUsdc: 0.12 })
    );
    const kp = Keypair.random();

    const baseFetch: typeof globalThis.fetch = jest.fn(async (input) => {
      const req = input as Request;
      const isCallA = req.url.includes('/call-a');
      if (req.headers.has('PAYMENT-SIGNATURE')) {
        // Delay call A so call B overlaps
        await new Promise((r) => setTimeout(r, isCallA ? 30 : 5));
        const xPay = req.headers.get('X-Payment')!;
        const decoded = JSON.parse(
          Buffer.from(xPay.slice('x402 '.length), 'base64').toString('utf8')
        ) as { facilitatorUrl: string };
        expect(decoded.facilitatorUrl).toBe(
          isCallA ? 'https://fac.a.local' : 'https://fac.b.local'
        );
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
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(ledger.getFeesSpentUsdc()).toBe(0.08);
    expect(ledger.getFeesReservedUsdc()).toBe(0);
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
