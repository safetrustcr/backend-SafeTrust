import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildUnsignedFundEscrowXdr } from '../deposit';
import { getDefaultUsdcContract } from '../payments';
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

  it('produces the expected end-to-end testnet transcript', async () => {
    const lines = await runTestnetTranscript();
    expect(lines[0]).toContain('search_properties   FREE (session)  2 found');
    expect(lines[1]).toContain('Villa Arenal Vista: 150.00 total, 45.00 deposit');
    expect(lines[2]).toContain('hold_dates          0.01 USDC x402  held until 14:32');
    expect(lines[3]).toContain('user: yes');
    expect(lines[4]).toContain('create_booking      0.10 USDC x402  escrow created');
    expect(lines[5]).toContain('fund_deposit        45.00 USDC     signed by your wallet -> escrow contract');
    expect(lines[6]).toBe('Fees 0.11 / 0.50 USDC · Deposit 45.00 / 50.00 USDC');
  });
});
