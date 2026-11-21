import { Keypair } from '@stellar/stellar-sdk';
import {
  SpendingLedger,
  SpendingLimitError,
  createPaymentFetch,
  getDefaultUsdcContract,
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
      if (req.headers.has('PAYMENT-SIGNATURE') || req.headers.has('X-Payment')) {
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
