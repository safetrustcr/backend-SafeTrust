'use strict';

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
}));

const { syncWalletHandler } = require('../sync-wallet.handler');
const db = require('../../../services/db');

// Real, checksum-valid Stellar address (matches the Karate sync-wallet fixture).
const VALID_STELLAR = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
// Fabricated address with the right shape but a bad SEP-23 checksum.
const BAD_CHECKSUM_STELLAR = 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z';

// Whether the Rust stellar-utils addon is built in this environment. When it
// is, validation is stricter (checksum + Ed25519-public-key-only) than the JS
// fallback regex, so addon-only assertions are gated on its presence.
let hasNativeAddon = false;
try {
  require('../../../../../crates/stellar-utils');
  hasNativeAddon = true;
} catch (err) {
  // Addon not built — JS fallback regex is in use.
}

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function makeRequest(body, uid = 'user-1') {
  return { user: { uid }, body };
}

describe('syncWalletHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when wallet_address is missing', async () => {
    const req = makeRequest({ chain_type: 'STELLAR', is_primary: false });
    const res = makeResponse();

    await syncWalletHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'wallet_address is required' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns 400 when chain_type is invalid', async () => {
    const req = makeRequest({
      wallet_address: VALID_STELLAR,
      chain_type: 'INVALID',
      is_primary: false,
    });
    const res = makeResponse();

    await syncWalletHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'chain_type must be one of: ETH, STELLAR, BSC',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns 400 when is_primary is not a boolean', async () => {
    const req = makeRequest({
      wallet_address: VALID_STELLAR,
      chain_type: 'STELLAR',
      is_primary: 'yes',
    });
    const res = makeResponse();

    await syncWalletHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'is_primary must be a boolean' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed Stellar address', async () => {
    const req = makeRequest({
      wallet_address: 'not-a-stellar-address',
      chain_type: 'STELLAR',
      is_primary: false,
    });
    const res = makeResponse();

    await syncWalletHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Stellar wallet address' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('accepts a valid Stellar address and upserts the wallet', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 'wallet-1',
          wallet_address: VALID_STELLAR,
          chain_type: 'STELLAR',
          is_primary: true,
        },
      ],
    });

    const req = makeRequest({
      wallet_address: VALID_STELLAR,
      chain_type: 'STELLAR',
      is_primary: true,
    });
    const res = makeResponse();

    await syncWalletHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      wallet_address: VALID_STELLAR,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1]).toEqual([
      'user-1',
      VALID_STELLAR,
      'STELLAR',
      true,
    ]);
  });

  it('returns 500 when the database upsert fails', async () => {
    db.query.mockRejectedValue(new Error('connection refused'));

    const req = makeRequest({
      wallet_address: VALID_STELLAR,
      chain_type: 'STELLAR',
      is_primary: false,
    });
    const res = makeResponse();

    await syncWalletHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to sync wallet' });
  });

  // ── Stricter checks only enforced by the Rust addon ───────────────────────

  const withNativeAddon = hasNativeAddon ? it : it.skip;

  withNativeAddon('rejects a G-address with a bad SEP-23 checksum', async () => {
    const req = makeRequest({
      wallet_address: BAD_CHECKSUM_STELLAR,
      chain_type: 'STELLAR',
      is_primary: false,
    });
    const res = makeResponse();

    await syncWalletHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Stellar wallet address' });
    expect(db.query).not.toHaveBeenCalled();
  });

  withNativeAddon('rejects a valid contract (C…) strkey, which is not an account', async () => {
    // Valid SEP-23 contract strkey — passes checksum but is not an Ed25519
    // public key, so it is not a Stellar account address.
    const req = makeRequest({
      wallet_address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      chain_type: 'STELLAR',
      is_primary: false,
    });
    const res = makeResponse();

    await syncWalletHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Stellar wallet address' });
  });
});
