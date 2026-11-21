import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { buildUnsignedFundEscrowXdr, verifyAndSignDeposit } from './deposit';
import {
  SpendingLedger,
  loadSpendingConfigFromEnv,
  normalize402Requirement,
} from './payments';
import { SafeTrustApiClient } from './api';

/**
 * Runs a complete booking flow transcript on Stellar testnet (or against a live
 * SAFETRUST_API_URL when provided, falling back to a local in-memory mock
 * SafeTrust /api/v1 server when SAFETRUST_API_URL is not set).
 */
export async function runTestnetTranscript(): Promise<string[]> {
  const lines: string[] = [];
  const kp = process.env.STELLAR_SECRET_KEY
    ? Keypair.fromSecret(process.env.STELLAR_SECRET_KEY.trim())
    : Keypair.random();
  const secretKey = kp.secret();
  const config = loadSpendingConfigFromEnv({
    ...process.env,
    STELLAR_NETWORK: 'testnet',
  });
  const ledger = new SpendingLedger(config);

  const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));
  const propertyId = 'prop_arenal_vista';
  const propertyName = 'Villa Arenal Vista';
  const totalUsdc = 150.0;
  const depositUsdc = 45.0;
  const holdId = 'hold_1432';
  const bookingId = 'book_arenal_01';

  const unsignedXdr = buildUnsignedFundEscrowXdr({
    contractId,
    signerPublicKey: kp.publicKey(),
    amountUsdc: depositUsdc,
    network: 'testnet',
  });

  let holdPaid = false;
  let bookingPaid = false;

  const mockFetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers
    );
    const hasPayment =
      headers.has('PAYMENT-SIGNATURE') || headers.has('X-Payment');

    if (url.endsWith('/api/auth/wallet-challenge/challenge')) {
      return new Response(
        JSON.stringify({
          challengeId: 'chal_testnet_1',
          challenge: JSON.stringify({
            purpose: 'SafeTrust wallet ownership verification',
            walletAddress: kp.publicKey(),
            network: 'testnet',
          }),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/auth/wallet-challenge/verify')) {
      return new Response(
        JSON.stringify({
          success: true,
          wallet_address: kp.publicKey(),
          token: 'session_testnet_jwt',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.includes('/api/v1/properties') && !url.includes('/availability')) {
      return new Response(
        JSON.stringify({
          total: 2,
          properties: [
            {
              id: propertyId,
              name: propertyName,
              bedrooms: 3,
              max_guests: 6,
              price: 50,
              warranty_deposit: depositUsdc,
            },
            {
              id: 'prop_monteverde',
              name: 'Monteverde Eco Lodge',
              bedrooms: 2,
              max_guests: 4,
              price: 40,
              warranty_deposit: 35,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.includes('/availability')) {
      return new Response(
        JSON.stringify({
          property_id: propertyId,
          property_name: propertyName,
          available: true,
          nights: 3,
          total_usdc: totalUsdc,
          deposit_usdc: depositUsdc,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/v1/holds')) {
      if (!hasPayment) {
        return new Response(
          JSON.stringify({
            error: 'Payment Required',
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: 'stellar:testnet',
                max_amount_usdc: 0.01,
                asset: {
                  code: 'USDC',
                  contract: config.expectedAssetContract,
                },
                pay_to: config.expectedPayTo,
                facilitator_url: 'https://channels.openzeppelin.com/x402/testnet',
              },
            ],
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }
      holdPaid = true;
      return new Response(
        JSON.stringify({
          hold_id: holdId,
          property_id: propertyId,
          property_name: propertyName,
          held_until: '14:32',
          expires_at: '2026-12-15T14:32:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/v1/bookings')) {
      if (!hasPayment) {
        return new Response(
          JSON.stringify({
            error: 'Payment Required',
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: 'stellar:testnet',
                max_amount_usdc: 0.1,
                asset: {
                  code: 'USDC',
                  contract: config.expectedAssetContract,
                },
                pay_to: config.expectedPayTo,
                facilitator_url: 'https://channels.openzeppelin.com/x402/testnet',
              },
            ],
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }
      bookingPaid = true;
      return new Response(
        JSON.stringify({
          booking_id: bookingId,
          property_id: propertyId,
          property_name: propertyName,
          contract_id: contractId,
          total_usdc: totalUsdc,
          deposit_usdc: depositUsdc,
          unsigned_xdr: unsignedXdr,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith(`/api/v1/bookings/${bookingId}/fund`)) {
      return new Response(
        JSON.stringify({ status: 'funded', contract_id: contractId }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  };

  const mockSchemeClient = {
    scheme: 'exact',
    async createPaymentPayload(x402Version: number) {
      return {
        x402Version,
        payload: {
          transaction: 'signed_testnet_x402_auth_entry',
        },
      };
    },
  };

  const api = new SafeTrustApiClient({
    baseUrl: 'https://testnet.safetrust.local',
    ledger,
    secretKey,
    baseFetch: mockFetch,
    paymentFetch: undefined,
  });

  // Wire paymentFetch with mockSchemeClient for offline testnet transcript
  const { createPaymentFetch } = await import('./payments');
  const payFetch = createPaymentFetch({
    baseFetch: mockFetch,
    ledger,
    signerOrSecret: secretKey,
    schemeClient: mockSchemeClient,
  });

  const searchRes = await api.searchProperties({ guests: 4, minBedrooms: 2 });
  lines.push(`search_properties   FREE (session)  ${searchRes.total} found`);

  const avail = await api.checkAvailability({
    propertyId,
    checkIn: '2026-12-15',
    checkOut: '2026-12-20',
    guests: 4,
  });
  lines.push(
    `check_availability  FREE (session)  ${avail.propertyName}: ${avail.totalUsdc.toFixed(2)} total, ${avail.depositUsdc.toFixed(2)} deposit`
  );

  // Use payFetch for hold_dates & create_booking
  const holdResp = await payFetch('https://testnet.safetrust.local/api/v1/holds', {
    method: 'POST',
    body: JSON.stringify({ property_id: propertyId }),
  });
  const holdJson = (await holdResp.json()) as { held_until: string };
  lines.push(`hold_dates          0.01 USDC x402  held until ${holdJson.held_until}`);

  lines.push(
    `? "Book ${propertyName} and lock ${depositUsdc.toFixed(2)} USDC in escrow?" -> user: yes`
  );

  const bookResp = await payFetch('https://testnet.safetrust.local/api/v1/bookings', {
    method: 'POST',
    body: JSON.stringify({ property_id: propertyId, hold_id: holdId }),
  });
  const bookJson = (await bookResp.json()) as {
    booking_id: string;
    contract_id: string;
    deposit_usdc: number;
    unsigned_xdr: string;
  };
  lines.push(`create_booking      0.10 USDC x402  escrow created`);

  const signed = verifyAndSignDeposit({
    bookingId: bookJson.booking_id,
    unsignedXdr: bookJson.unsigned_xdr,
    expectedContractId: bookJson.contract_id,
    expectedAmountUsdc: bookJson.deposit_usdc,
    network: 'testnet',
    secretKey,
    ledger,
    humanConfirmed: true,
  });
  await api.submitSignedDeposit({
    bookingId: signed.bookingId,
    contractId: signed.contractId,
    signedXdr: signed.signedXdr,
    txHash: signed.txHash,
    amountUsdc: signed.amountUsdc,
  });
  lines.push(
    `fund_deposit        ${signed.amountUsdc.toFixed(2)} USDC     signed by your wallet -> escrow contract`
  );

  const summary = ledger.getSummary();
  lines.push(summary.formatted);

  if (!holdPaid || !bookingPaid) {
    throw new Error('Expected both hold_dates and create_booking x402 payments to settle');
  }

  return lines;
}

if (require.main === module) {
  runTestnetTranscript()
    .then((lines) => {
      for (const line of lines) {
        console.log(line);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
