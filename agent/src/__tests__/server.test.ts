import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SafeTrustApiClient } from '../api';
import { buildUnsignedFundEscrowXdr } from '../deposit';
import { SpendingLedger, getDefaultUsdcContract } from '../payments';
import { createBookingAgentServer } from '../server';
import { runTestnetTranscript } from '../demo-testnet';

const PLATFORM_WALLET =
  'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const TESTNET_USDC = getDefaultUsdcContract('testnet');

function getToolText(res: unknown): string {
  const items = (res as { content: Array<{ type: string; text: string }> }).content;
  return items[0].text;
}

describe('MCP Booking Agent Server', () => {
  it('exposes all required tools and supports two-step prepare_deposit / confirm_deposit when elicitation is absent', async () => {
    const kp = Keypair.random();
    const secretKey = kp.secret();
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 5));
    const unsignedXdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45,
      network: 'testnet',
    });

    const baseFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/auth/wallet-challenge/challenge')) {
        return new Response(
          JSON.stringify({
            challengeId: 'c1',
            challenge: 'sign-me',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/auth/wallet-challenge/verify')) {
        return new Response(
          JSON.stringify({ success: true, token: 'tok_1' }),
          { status: 200 }
        );
      }
      if (url.includes('/api/v1/properties')) {
        return new Response(
          JSON.stringify({
            total: 1,
            properties: [
              {
                id: 'p1',
                name: 'Villa Arenal Vista',
                price: 50,
                warranty_deposit: 45,
                bedrooms: 2,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/bookings/b1/fund')) {
        return new Response(
          JSON.stringify({ status: 'funded', contract_id: contractId }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
    };

    const { server, api } = createBookingAgentServer({
      secretKey,
      apiBaseUrl: 'https://testnet.safetrust.local',
      baseFetch,
      allowFallbackConfirmation: true,
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: TESTNET_USDC,
      },
    });

    api.registerBooking({
      bookingId: 'b1',
      propertyId: 'p1',
      propertyName: 'Villa Arenal Vista',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 45,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const toolsRes = await client.listTools();
    const toolNames = toolsRes.tools.map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'search_properties',
        'check_availability',
        'hold_dates',
        'release_hold',
        'create_booking',
        'fund_deposit',
        'spending_summary',
        'prepare_deposit',
        'confirm_deposit',
      ])
    );

    // Search properties (free)
    const searchOut = await client.callTool({
      name: 'search_properties',
      arguments: { guests: 4, min_bedrooms: 2 },
    });
    const searchText = getToolText(searchOut);
    expect(searchText).toContain('Villa Arenal Vista');
    expect(searchText).not.toContain(secretKey);

    // Calling fund_deposit without elicitation returns confirmation_id and does NOT sign
    const prepOut = await client.callTool({
      name: 'fund_deposit',
      arguments: { booking_id: 'b1' },
    });
    const prepJson = JSON.parse(getToolText(prepOut));
    expect(prepJson.status).toBe('confirmation_required');
    expect(prepJson.confirmation_id).toMatch(/^conf_/);

    // Confirming with human_confirmed: false refuses to sign
    const deniedOut = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: prepJson.confirmation_id,
        human_confirmed: false,
      },
    });
    expect(deniedOut.isError).toBe(true);

    // Confirming with human_confirmed: true signs and submits
    const okOut = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: prepJson.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(okOut.isError).toBeFalsy();
    const okJson = JSON.parse(getToolText(okOut));
    expect(okJson.status).toBe('funded');
    expect(okJson.amountUsdc).toBe(45);
    expect(JSON.stringify(okJson)).not.toContain(secretKey);

    // spending_summary reflects the locked deposit and never leaks secretKey
    const summaryOut = await client.callTool({
      name: 'spending_summary',
      arguments: {},
    });
    const summaryText = getToolText(summaryOut);
    expect(summaryText).toContain('Deposit 45.00 / 50.00 USDC');
    expect(summaryText).not.toContain(secretKey);

    await client.close();
  });

  it('uses MCP elicitation when supported by the client', async () => {
    const kp = Keypair.random();
    const secretKey = kp.secret();
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 6));
    const unsignedXdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45,
      network: 'testnet',
    });

    const baseFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/auth/wallet-challenge/challenge')) {
        return new Response(
          JSON.stringify({
            challengeId: 'c1',
            challenge: 'sign-me',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/auth/wallet-challenge/verify')) {
        return new Response(
          JSON.stringify({ success: true, token: 'tok_1' }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/bookings/b2/fund')) {
        return new Response(
          JSON.stringify({ status: 'funded', contract_id: contractId }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
    };

    const { server, api } = createBookingAgentServer({
      secretKey,
      apiBaseUrl: 'https://testnet.safetrust.local',
      baseFetch,
      allowFallbackConfirmation: true,
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: TESTNET_USDC,
      },
    });

    api.registerBooking({
      bookingId: 'b2',
      propertyId: 'p1',
      propertyName: 'Villa Arenal Vista',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 45,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'elicit-client', version: '1.0.0' },
      { capabilities: { elicitation: {} } }
    );

    client.setRequestHandler(ElicitRequestSchema, async () => ({
      action: 'accept',
      content: { confirm: true },
    }));

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: 'fund_deposit',
      arguments: { booking_id: 'b2' },
    });
    const parsed = JSON.parse(getToolText(res));
    expect(parsed.status).toBe('funded');
    expect(parsed.contractId).toBe(contractId);

    await client.close();
  });

  it('falls back to a confirmation_id when the client only supports URL elicitation', async () => {
    const kp = Keypair.random();
    const secretKey = kp.secret();
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 8));
    const unsignedXdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45,
      network: 'testnet',
    });

    const { server, api } = createBookingAgentServer({
      secretKey,
      apiBaseUrl: 'https://testnet.safetrust.local',
      allowFallbackConfirmation: true,
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: TESTNET_USDC,
      },
    });

    api.registerBooking({
      bookingId: 'b_url_only',
      propertyId: 'p1',
      propertyName: 'Villa Arenal Vista',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 45,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'url-only-elicit-client', version: '1.0.0' },
      { capabilities: { elicitation: { url: {} } } }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({
      name: 'fund_deposit',
      arguments: { booking_id: 'b_url_only' },
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(getToolText(res));
    expect(parsed.status).toBe('confirmation_required');
    expect(parsed.confirmation_id).toMatch(/^conf_/);

    // If booking terms (contractId or depositUsdc) change before confirmation, both confirm_deposit and fund_deposit reject
    api.registerBooking({
      bookingId: 'b_url_only',
      propertyId: 'p1',
      propertyName: 'Villa Arenal Vista',
      contractId: StrKey.encodeContract(Buffer.alloc(32, 9)),
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 49,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    const tamperedOut = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: parsed.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(tamperedOut.isError).toBe(true);
    expect(getToolText(tamperedOut)).toContain('terms changed');

    await client.close();
  });

  it('rejects caller-supplied human_confirmed boolean in fallback paths unless host fallback or verifyHumanApproval is enabled', async () => {
    const kp = Keypair.random();
    const secretKey = kp.secret();
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 11));
    const unsignedXdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45,
      network: 'testnet',
    });

    const { server, api, ledger } = createBookingAgentServer({
      secretKey,
      apiBaseUrl: 'https://testnet.safetrust.local',
      allowFallbackConfirmation: false,
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: TESTNET_USDC,
      },
    });

    api.registerBooking({
      bookingId: 'b_gate',
      propertyId: 'p1',
      propertyName: 'Villa Arenal Vista',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 45,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'no-elicit-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // Both prepare_deposit and fund_deposit must report fallback approval unavailable BEFORE issuing a confirmation_id
    const prepOut = await client.callTool({
      name: 'prepare_deposit',
      arguments: { booking_id: 'b_gate' },
    });
    expect(prepOut.isError).toBe(true);
    expect(getToolText(prepOut)).toContain('HUMAN_CONFIRMATION_REQUIRED');
    expect(getToolText(prepOut)).not.toContain('conf_');

    const fundOut = await client.callTool({
      name: 'fund_deposit',
      arguments: { booking_id: 'b_gate' },
    });
    expect(fundOut.isError).toBe(true);
    expect(getToolText(fundOut)).toContain('HUMAN_CONFIRMATION_REQUIRED');
    expect(getToolText(fundOut)).not.toContain('conf_');
    expect(ledger.getDepositsLockedUsdc()).toBe(0);

    await client.close();
  });

  it('redacts the exact configured secretKey from successful search_properties output', async () => {
    const kp = Keypair.random();
    const secretKey = kp.secret();

    const baseFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/auth/wallet-challenge/challenge')) {
        return new Response(
          JSON.stringify({
            challengeId: 'c1',
            challenge: 'sign-me',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/auth/wallet-challenge/verify')) {
        return new Response(
          JSON.stringify({ success: true, token: 'tok_1' }),
          { status: 200 }
        );
      }
      if (url.includes('/api/v1/properties')) {
        return new Response(
          JSON.stringify({
            total: 1,
            properties: [
              {
                id: 'p_leak',
                name: 'Villa Secret',
                description: `Leaked key inside description: ${secretKey}`,
                price: 50,
                warranty_deposit: 45,
                bedrooms: 2,
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
    };

    const { server } = createBookingAgentServer({
      secretKey,
      apiBaseUrl: 'https://testnet.safetrust.local',
      baseFetch,
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: TESTNET_USDC,
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'redact-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const searchOut = await client.callTool({
      name: 'search_properties',
      arguments: {},
    });
    expect(searchOut.isError).toBeFalsy();
    const text = getToolText(searchOut);
    expect(text).not.toContain(secretKey);
    expect(text).toContain('[REDACTED_SECRET_KEY]');

    await client.close();
  });

  it('shows exact nonzero USDC deposit digits in prompts and rejects spoofed booking asset contracts', async () => {
    const kp = Keypair.random();
    const secretKey = kp.secret();
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 12));
    const fakeAssetContract = StrKey.encodeContract(Buffer.alloc(32, 99));
    const unsignedXdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45.004,
      network: 'testnet',
    });

    const { server, api } = createBookingAgentServer({
      secretKey,
      apiBaseUrl: 'https://testnet.safetrust.local',
      allowFallbackConfirmation: true,
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: TESTNET_USDC,
      },
    });

    api.registerBooking({
      bookingId: 'b_exact',
      propertyId: 'p1',
      propertyName: 'Villa Precision',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 45.004,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    api.registerBooking({
      bookingId: 'b_spoofed_asset',
      propertyId: 'p1',
      propertyName: 'Villa Spoof',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 45,
      assetCode: 'USDC',
      assetContract: fakeAssetContract,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'precision-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const prepText = getToolText(
      await client.callTool({
        name: 'prepare_deposit',
        arguments: { booking_id: 'b_exact' },
      })
    );
    expect(prepText).toContain('45.004 USDC');

    const fundFallbackText = getToolText(
      await client.callTool({
        name: 'fund_deposit',
        arguments: { booking_id: 'b_exact' },
      })
    );
    expect(fundFallbackText).toContain('45.004 USDC');

    // Spoofed asset contract must be rejected before offering confirmation
    const spoofedOut = await client.callTool({
      name: 'prepare_deposit',
      arguments: { booking_id: 'b_spoofed_asset' },
    });
    expect(spoofedOut.isError).toBe(true);
    expect(getToolText(spoofedOut)).toContain('ASSET_MISMATCH');

    await client.close();
  });

  it('enforces single-flight funding, does not lock ledger on 4xx failure, and reconciles uncertain outcomes', async () => {
    const kp = Keypair.random();
    const secretKey = kp.secret();
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 13));
    const unsignedXdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45,
      network: 'testnet',
    });

    let fundBehavior: 'reject400' | 'fail500' | 'slow200' = 'reject400';
    let reconcileStatus: 'funded' | 'escrow_created' = 'funded';
    let fundCalls = 0;
    let reconcileFundCalls = 0;
    let reconciledTxHash: string | null = null;

    const baseFetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/auth/wallet-challenge/challenge')) {
        return new Response(
          JSON.stringify({
            challengeId: 'c1',
            challenge: 'sign-me',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/auth/wallet-challenge/verify')) {
        return new Response(
          JSON.stringify({ success: true, token: 'tok_1' }),
          { status: 200 }
        );
      }
      if (url.includes('/api/v1/bookings/b_lock/fund')) {
        fundCalls += 1;
        if (fundBehavior === 'reject400') {
          return new Response(JSON.stringify({ error: 'bad xdr' }), { status: 400 });
        }
        if (fundBehavior === 'fail500') {
          return new Response(JSON.stringify({ error: 'gateway timeout' }), {
            status: 504,
          });
        }
        await new Promise((r) => setTimeout(r, 40));
        return new Response(
          JSON.stringify({ status: 'funded', contract_id: contractId }),
          { status: 200 }
        );
      }
      if (url.includes('/api/v1/bookings/b_reconcile/fund')) {
        reconcileFundCalls += 1;
        const bodyRaw =
          typeof init?.body === 'string'
            ? init.body
            : input instanceof Request
              ? await input.clone().text()
              : '{}';
        const parsedBody = JSON.parse(bodyRaw) as { tx_hash?: string };
        if (parsedBody.tx_hash && !reconciledTxHash) {
          reconciledTxHash = parsedBody.tx_hash;
        }
        return new Response(JSON.stringify({ error: 'gateway timeout' }), {
          status: 504,
        });
      }
      if (url.includes('/api/v1/bookings/b_lock?tx_hash=')) {
        return new Response(JSON.stringify({ status: reconcileStatus }), {
          status: 200,
        });
      }
      if (url.includes('/api/v1/bookings/b_reconcile?tx_hash=')) {
        const parsedUrl = new URL(url);
        expect(parsedUrl.searchParams.get('tx_hash')).toBe(reconciledTxHash);
        return new Response(JSON.stringify({ status: reconcileStatus }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
    };

    const { server, api, ledger } = createBookingAgentServer({
      secretKey,
      apiBaseUrl: 'https://testnet.safetrust.local',
      baseFetch,
      allowFallbackConfirmation: true,
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: TESTNET_USDC,
      },
    });

    api.registerBooking({
      bookingId: 'b_lock',
      propertyId: 'p1',
      propertyName: 'Villa Lock',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 45,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'lock-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // 1. Definite 400 rejection must NOT lock ledger and must allow recovery
    const prep1 = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: 'b_lock' },
        })
      )
    );
    const fail400 = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: prep1.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(fail400.isError).toBe(true);
    expect(ledger.getDepositsLockedUsdc()).toBe(0);

    // 2. Concurrent confirm_deposit calls with the same confirmation_id -> only one succeeds
    fundBehavior = 'slow200';
    const prep2 = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: 'b_lock' },
        })
      )
    );
    const [r1, r2] = await Promise.all([
      client.callTool({
        name: 'confirm_deposit',
        arguments: {
          confirmation_id: prep2.confirmation_id,
          human_confirmed: true,
        },
      }),
      client.callTool({
        name: 'confirm_deposit',
        arguments: {
          confirmation_id: prep2.confirmation_id,
          human_confirmed: true,
        },
      }),
    ]);
    const errors = [r1, r2].filter((r) => r.isError);
    const successes = [r1, r2].filter((r) => !r.isError);
    expect(successes).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(ledger.getDepositsLockedUsdc()).toBe(45);
    expect(fundCalls).toBe(2); // 1 failed 400 + 1 successful 200

    // 3. Subsequent attempt on already-funded booking is rejected
    const prep3 = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: 'b_lock' },
        })
      )
    );
    const dupOut = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: prep3.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(dupOut.isError).toBe(true);
    expect(getToolText(dupOut)).toContain('ALREADY_FUNDED');
    expect(ledger.getDepositsLockedUsdc()).toBe(45);

    // 4. Uncertain 504 outcome reconciles by original txHash as funded without sending a second funding POST
    const booking2Id = 'b_reconcile';
    api.registerBooking({
      bookingId: booking2Id,
      propertyId: 'p1',
      propertyName: 'Villa Reconcile',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 40,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr: buildUnsignedFundEscrowXdr({
        contractId,
        signerPublicKey: kp.publicKey(),
        amountUsdc: 40,
        network: 'testnet',
      }),
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    const prep4 = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: booking2Id },
        })
      )
    );
    const fail504 = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: prep4.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(fail504.isError).toBe(true);
    expect(reconcileFundCalls).toBe(1);
    expect(reconciledTxHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ledger.getDepositsLockedUsdc()).toBe(45);

    // Retry triggers reconciliation using original txHash, records deposit once, and sends no second POST
    const prep5 = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: booking2Id },
        })
      )
    );
    const reconciledOut = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: prep5.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(reconciledOut.isError).toBe(true);
    expect(getToolText(reconciledOut)).toContain('ALREADY_FUNDED');
    expect(reconcileFundCalls).toBe(1);
    expect(ledger.getDepositsLockedUsdc()).toBe(85);

    await client.close();
  });

  it('scopes cached quotes to the stay and retains booking_id when post-response deposit exceeds cap', async () => {
    const kp = Keypair.random();
    const ledger = new SpendingLedger({
      maxFeePerCallUsdc: 0.1,
      feeBudgetUsdc: 0.5,
      maxDepositUsdc: 50,
      network: 'testnet',
      expectedPayTo: PLATFORM_WALLET,
      expectedAssetContract: TESTNET_USDC,
    });

    const baseFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/auth/wallet-challenge/challenge')) {
        return new Response(
          JSON.stringify({
            challengeId: 'c1',
            challenge: 'sign-me',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/auth/wallet-challenge/verify')) {
        return new Response(
          JSON.stringify({ success: true, token: 'tok_1' }),
          { status: 200 }
        );
      }
      if (url.includes('/availability') && url.includes('check_in=2026-12-01')) {
        return new Response(
          JSON.stringify({
            property_id: 'p1',
            property_name: 'Villa Stay',
            available: true,
            nights: 5,
            total_usdc: 200,
            deposit_usdc: 60,
          }),
          { status: 200 }
        );
      }
      if (url.includes('/availability') && url.includes('check_in=2026-12-10')) {
        return new Response(
          JSON.stringify({ error: 'no quote' }),
          { status: 404 }
        );
      }
      if (url.endsWith('/api/v1/bookings')) {
        return new Response(
          JSON.stringify({
            booking_id: 'book_over_cap_1',
            property_id: 'p1',
            contract_id: StrKey.encodeContract(Buffer.alloc(32, 14)),
            total_usdc: 220,
            deposit_usdc: 65,
            unsigned_xdr: '',
          }),
          { status: 201 }
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
    };

    const api = new SafeTrustApiClient({
      baseUrl: 'https://testnet.safetrust.local',
      ledger,
      secretKey: kp.secret(),
      baseFetch,
    });

    // Check stay #1 (deposit 60 USDC > 50 USDC cap)
    const q1 = await api.checkAvailability({
      propertyId: 'p1',
      checkIn: '2026-12-01',
      checkOut: '2026-12-06',
    });
    expect(q1.depositUsdc).toBe(60);

    // Booking stay #2 at the same property must NOT reuse stay #1's 60 USDC quote;
    // if the backend returns 65 USDC, the booking ID must still be retained & exposed in the error.
    await expect(
      api.createBooking({
        propertyId: 'p1',
        checkIn: '2026-12-10',
        checkOut: '2026-12-12',
      })
    ).rejects.toThrow(/book_over_cap_1/);
    expect(api.getBooking('book_over_cap_1')?.bookingId).toBe('book_over_cap_1');
  });

  it('produces the expected end-to-end testnet transcript (including custom USDC contract)', async () => {
    const customUsdc = StrKey.encodeContract(Buffer.alloc(32, 42));
    const lines = await runTestnetTranscript({
      secretKey: Keypair.random().secret(),
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: customUsdc,
      },
    });
    expect(lines[0]).toContain('search_properties   FREE (session)  2 found');
    expect(lines[1]).toContain('Villa Arenal Vista: 150.00 total, 45.00 deposit');
    expect(lines[2]).toContain('hold_dates          0.01 USDC x402  held until 14:32');
    expect(lines[3]).toContain('user: yes');
    expect(lines[4]).toContain('create_booking      0.10 USDC x402  escrow created');
    expect(lines[5]).toContain('fund_deposit        45.00 USDC     signed by your wallet -> escrow contract');
    expect(lines[6]).toBe('Fees 0.11 / 0.50 USDC · Deposit 45.00 / 50.00 USDC');
  });

  it('requires hold guest count to match, preserves unknown cached deposits, and defaults omitted booking asset to configured USDC contract', async () => {
    const kp = Keypair.random();
    const customUsdc = StrKey.encodeContract(Buffer.alloc(32, 43));
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 44));
    const ledger = new SpendingLedger({
      maxFeePerCallUsdc: 0.1,
      feeBudgetUsdc: 0.5,
      maxDepositUsdc: 50,
      network: 'testnet',
      expectedPayTo: PLATFORM_WALLET,
      expectedAssetContract: customUsdc,
    });

    let bookingCalls = 0;
    const baseFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/auth/wallet-challenge/challenge')) {
        return new Response(
          JSON.stringify({
            challengeId: 'c1',
            challenge: 'sign-me',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/auth/wallet-challenge/verify')) {
        return new Response(
          JSON.stringify({ success: true, token: 'tok_1' }),
          { status: 200 }
        );
      }
      if (url.includes('/availability')) {
        if (url.includes('guests=4')) {
          return new Response(
            JSON.stringify({
              property_id: 'p1',
              property_name: 'Villa Guest',
              available: true,
              nights: 3,
              total_usdc: 120,
              deposit_usdc: 45,
            }),
            { status: 200 }
          );
        }
        // Omitted deposit quote for p_omitted
        return new Response(
          JSON.stringify({
            property_id: 'p_omitted',
            property_name: 'Villa Omitted',
            available: true,
            nights: 2,
            total_usdc: 90,
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/holds')) {
        return new Response(
          JSON.stringify({
            hold_id: 'h_2guests',
            deposit_usdc: 60,
            total_usdc: 180,
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/bookings')) {
        bookingCalls += 1;
        return new Response(
          JSON.stringify({
            booking_id: `book_ok_${bookingCalls}`,
            contract_id: contractId,
            deposit_usdc: 45,
            total_usdc: 120,
            unsigned_xdr: buildUnsignedFundEscrowXdr({
              contractId,
              signerPublicKey: kp.publicKey(),
              amountUsdc: 45,
              network: 'testnet',
              assetContract: customUsdc,
            }),
          }),
          { status: 201 }
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
    };

    const api = new SafeTrustApiClient({
      baseUrl: 'https://testnet.safetrust.local',
      ledger,
      secretKey: kp.secret(),
      baseFetch,
      paymentFetch: baseFetch,
    });

    // 1. A 2-guest hold (60 USDC) must NOT override a 4-guest availability quote (45 USDC)
    await api.holdDates({
      propertyId: 'p1',
      checkIn: '2026-12-15',
      checkOut: '2026-12-18',
      guests: 2,
    });
    await api.checkAvailability({
      propertyId: 'p1',
      checkIn: '2026-12-15',
      checkOut: '2026-12-18',
      guests: 4,
    });
    const b1 = await api.createBooking({
      propertyId: 'p1',
      checkIn: '2026-12-15',
      checkOut: '2026-12-18',
      guests: 4,
      holdId: 'h_2guests',
    });
    expect(b1.bookingId).toBe('book_ok_1');
    // Omitted asset_contract defaults to configured SAFETRUST_USDC_CONTRACT
    expect(b1.assetContract).toBe(customUsdc);

    // 2. Omitted deposit in checkAvailability returns null (unknown) and createBooking retries preflight before paying
    const omittedQuote = await api.checkAvailability({
      propertyId: 'p_omitted',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22',
    });
    expect(omittedQuote.depositUsdc).toBeNull();
    const b2 = await api.createBooking({
      propertyId: 'p_omitted',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22',
    });
    expect(b2.bookingId).toBe('book_ok_2');
  });

  it('re-checks nonrepresentable booking amounts and fallback confirmation expiry before signing', async () => {
    const kp = Keypair.random();
    const secretKey = kp.secret();
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 47));
    let fundPostCalls = 0;

    const baseFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/auth/wallet-challenge/challenge')) {
        return new Response(
          JSON.stringify({
            challengeId: 'c1',
            challenge: 'sign-me',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/auth/wallet-challenge/verify')) {
        return new Response(
          JSON.stringify({ success: true, token: 'tok_1' }),
          { status: 200 }
        );
      }
      if (url.includes('/fund')) {
        fundPostCalls += 1;
        return new Response(
          JSON.stringify({ status: 'funded', contract_id: contractId }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
    };

    const { server, api } = createBookingAgentServer({
      secretKey,
      apiBaseUrl: 'https://testnet.safetrust.local',
      baseFetch,
      confirmationTtlMs: 30,
      verifyHumanApproval: async () => {
        // Delay past confirmationTtlMs so confirmation expires during approval await
        await new Promise((r) => setTimeout(r, 60));
        return true;
      },
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: TESTNET_USDC,
      },
    });

    const unsignedXdr = buildUnsignedFundEscrowXdr({
      contractId,
      signerPublicKey: kp.publicKey(),
      amountUsdc: 45,
      network: 'testnet',
    });

    api.registerBooking({
      bookingId: 'b_exp',
      propertyId: 'p1',
      propertyName: 'Villa Expiry',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 45,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'expiry-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // 1. Confirmation expiring during verifyHumanApproval await is rejected before signing
    const prepExp = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: 'b_exp' },
        })
      )
    );
    const expOut = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: prepExp.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(expOut.isError).toBe(true);
    expect(getToolText(expOut)).toContain('expired before signing');
    expect(fundPostCalls).toBe(0);

    // 2. Nonrepresentable quote change (45 -> 45.00000001) is rejected even though toFixed(7) would round both to 45
    const prepSub = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: 'b_exp' },
        })
      )
    );
    api.registerBooking({
      bookingId: 'b_exp',
      propertyId: 'p1',
      propertyName: 'Villa Expiry',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 45.00000001,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr,
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });
    const subOut = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: prepSub.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(subOut.isError).toBe(true);
    expect(getToolText(subOut)).toContain('terms changed');
    expect(fundPostCalls).toBe(0);

    await client.close();
  });

  it('redacts secret key in elicitation prompts, compares exact atomic amounts, and re-checks booking terms before signing', async () => {
    const kp = Keypair.random();
    const secretKey = kp.secret();
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 45));
    const otherContractId = StrKey.encodeContract(Buffer.alloc(32, 46));
    let fundPostCalls = 0;

    const baseFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/api/auth/wallet-challenge/challenge')) {
        return new Response(
          JSON.stringify({
            challengeId: 'c1',
            challenge: 'sign-me',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/auth/wallet-challenge/verify')) {
        return new Response(
          JSON.stringify({ success: true, token: 'tok_1' }),
          { status: 200 }
        );
      }
      if (url.includes('/fund')) {
        fundPostCalls += 1;
        return new Response(
          JSON.stringify({ status: 'funded', contract_id: contractId }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
    };

    let mutateDuringApproval = false;
    const { server, api } = createBookingAgentServer({
      secretKey,
      apiBaseUrl: 'https://testnet.safetrust.local',
      baseFetch,
      verifyHumanApproval: async (pending) => {
        if (mutateDuringApproval) {
          api.registerBooking({
            bookingId: pending.bookingId,
            propertyId: 'p1',
            propertyName: 'Villa Mutated',
            contractId: otherContractId,
            checkIn: '2026-12-15',
            checkOut: '2026-12-20',
            totalUsdc: 150,
            depositUsdc: pending.amountUsdc,
            assetCode: 'USDC',
            assetContract: TESTNET_USDC,
            unsignedXdr: buildUnsignedFundEscrowXdr({
              contractId: otherContractId,
              signerPublicKey: kp.publicKey(),
              amountUsdc: pending.amountUsdc,
              network: 'testnet',
            }),
            status: 'escrow_created',
            feePaidUsdc: 0.1,
          });
        }
        return true;
      },
      spendingConfig: {
        maxFeePerCallUsdc: 0.1,
        feeBudgetUsdc: 0.5,
        maxDepositUsdc: 50,
        network: 'testnet',
        expectedPayTo: PLATFORM_WALLET,
        expectedAssetContract: TESTNET_USDC,
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'elicit-security-client', version: '1.0.0' },
      { capabilities: { elicitation: { form: {} } } }
    );

    let capturedElicitMessage = '';
    let mutateDuringElicit = false;
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      capturedElicitMessage = req.params.message;
      if (mutateDuringElicit) {
        api.registerBooking({
          bookingId: 'b_elicit',
          propertyId: 'p1',
          propertyName: 'Villa Changed During Elicit',
          contractId: otherContractId,
          checkIn: '2026-12-15',
          checkOut: '2026-12-20',
          totalUsdc: 150,
          depositUsdc: 10,
          assetCode: 'USDC',
          assetContract: TESTNET_USDC,
          unsignedXdr: buildUnsignedFundEscrowXdr({
            contractId: otherContractId,
            signerPublicKey: kp.publicKey(),
            amountUsdc: 10,
            network: 'testnet',
          }),
          status: 'escrow_created',
          feePaidUsdc: 0.1,
        });
      }
      return { action: 'accept', content: { confirm: true } };
    });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // 1. Elicitation prompt redacts secretKey from propertyName AND rejects if terms mutate during prompt
    api.registerBooking({
      bookingId: 'b_elicit',
      propertyId: 'p1',
      propertyName: `Villa Leak ${secretKey} Resort`,
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 150,
      depositUsdc: 10,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr: buildUnsignedFundEscrowXdr({
        contractId,
        signerPublicKey: kp.publicKey(),
        amountUsdc: 10,
        network: 'testnet',
      }),
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });
    mutateDuringElicit = true;
    const elicitMutatedOut = await client.callTool({
      name: 'fund_deposit',
      arguments: { booking_id: 'b_elicit' },
    });
    expect(capturedElicitMessage).not.toContain(secretKey);
    expect(capturedElicitMessage).toContain('[REDACTED_SECRET_KEY]');
    expect(elicitMutatedOut.isError).toBe(true);
    expect(getToolText(elicitMutatedOut)).toContain('HUMAN_CONFIRMATION_REQUIRED');
    expect(fundPostCalls).toBe(0);

    // 2. Exact atomic amount check rejects a 1-stroop (0.0000001 USDC) change on both fallback paths
    api.registerBooking({
      bookingId: 'b_atomic',
      propertyId: 'p1',
      propertyName: 'Villa Atomic',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 1,
      depositUsdc: 0.1,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr: buildUnsignedFundEscrowXdr({
        contractId,
        signerPublicKey: kp.publicKey(),
        amountUsdc: 0.1,
        network: 'testnet',
      }),
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });
    const prepAtomic1 = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: 'b_atomic' },
        })
      )
    );
    const prepAtomic2 = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: 'b_atomic' },
        })
      )
    );
    // Bump by 1 stroop (0.1 -> 0.1000001)
    api.registerBooking({
      bookingId: 'b_atomic',
      propertyId: 'p1',
      propertyName: 'Villa Atomic',
      contractId,
      checkIn: '2026-12-15',
      checkOut: '2026-12-20',
      totalUsdc: 1,
      depositUsdc: 0.1000001,
      assetCode: 'USDC',
      assetContract: TESTNET_USDC,
      unsignedXdr: buildUnsignedFundEscrowXdr({
        contractId,
        signerPublicKey: kp.publicKey(),
        amountUsdc: 0.1000001,
        network: 'testnet',
      }),
      status: 'escrow_created',
      feePaidUsdc: 0.1,
    });
    const confirmAtomicOut = await client.callTool({
      name: 'confirm_deposit',
      arguments: {
        confirmation_id: prepAtomic1.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(confirmAtomicOut.isError).toBe(true);
    expect(getToolText(confirmAtomicOut)).toContain('terms changed');

    const fundAtomicOut = await client.callTool({
      name: 'fund_deposit',
      arguments: {
        booking_id: 'b_atomic',
        confirmation_id: prepAtomic2.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(fundAtomicOut.isError).toBe(true);
    expect(getToolText(fundAtomicOut)).toContain('terms changed');

    // 3. Re-checks booking terms AFTER verifyHumanApproval await on confirmation_id path
    const prepMutate = JSON.parse(
      getToolText(
        await client.callTool({
          name: 'prepare_deposit',
          arguments: { booking_id: 'b_atomic' },
        })
      )
    );
    mutateDuringApproval = true;
    const mutatedAfterApprovalOut = await client.callTool({
      name: 'fund_deposit',
      arguments: {
        booking_id: 'b_atomic',
        confirmation_id: prepMutate.confirmation_id,
        human_confirmed: true,
      },
    });
    expect(mutatedAfterApprovalOut.isError).toBe(true);
    expect(getToolText(mutatedAfterApprovalOut)).toContain('HUMAN_CONFIRMATION_REQUIRED');
    expect(fundPostCalls).toBe(0);

    await client.close();
  });
});
