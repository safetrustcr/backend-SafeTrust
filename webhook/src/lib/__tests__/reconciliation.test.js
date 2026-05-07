'use strict';

/**
 * @file src/lib/__tests__/reconciliation.test.js
 *
 * Unit tests for src/lib/reconciliation.js
 *
 * Strategy
 * ─────────
 *  • All external I/O (DB + HTTP) is mocked — no live database or network needed.
 *  • chunkArray  → pure function, tested exhaustively.
 *  • syncChunk   → DB + HTTP mocked; verifies counts and per-row error isolation.
 *  • fetchEscrowsByContractIds → HTTP mocked; verifies both API response shapes.
 */

// ─── Mock the DB service before requiring the module under test ───────────────
jest.mock('../../services/db', () => ({
  query: jest.fn(),
}));

// ─── Mock Node's built-in https so no real network calls fire ─────────────────
const https = require('https');
jest.mock('https');

const db = require('../../services/db');
const { chunkArray, syncChunk, fetchEscrowsByContractIds, CHUNK_SIZE } =
  require('../reconciliation');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal escrow object as the TrustlessWork indexer would return it.
 */
function makeEscrow(overrides = {}) {
  return {
    contractId: 'CDLZ_TEST_001',
    status: 'funded',
    amount: '100.0000000',
    balance: '0.0000000',
    escrowType: 'single_release',
    roles: { marker: 'MARKER', approver: 'APPROVER', releaser: 'RELEASER' },
    ...overrides,
  };
}

/**
 * Make `https.request` return a fake response with the given body/statusCode.
 */
function mockHttpResponse(body, statusCode = 200) {
  const { EventEmitter } = require('events');

  const fakeRes = new EventEmitter();
  fakeRes.statusCode = statusCode;
  fakeRes.setEncoding = jest.fn();

  const fakeReq = new EventEmitter();
  fakeReq.setTimeout = jest.fn();
  fakeReq.destroy = jest.fn();
  fakeReq.end = jest.fn(() => {
    // Emit data + end on the response in the next tick
    process.nextTick(() => {
      fakeRes.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
      fakeRes.emit('end');
    });
  });

  https.request.mockImplementation((_opts, cb) => {
    cb(fakeRes);
    return fakeReq;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// chunkArray
// ═══════════════════════════════════════════════════════════════════════════════
describe('chunkArray', () => {
  it('splits an array into correct chunk sizes', () => {
    const result = chunkArray([1, 2, 3, 4, 5], 2);
    expect(result).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when array is smaller than size', () => {
    const result = chunkArray(['a', 'b'], 50);
    expect(result).toEqual([['a', 'b']]);
  });

  it('returns empty array when input is empty', () => {
    expect(chunkArray([], 10)).toEqual([]);
  });

  it('handles chunk size equal to array length', () => {
    expect(chunkArray([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it('handles chunk size of 1', () => {
    expect(chunkArray([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it('throws TypeError when arr is not an array', () => {
    expect(() => chunkArray('not-an-array', 10)).toThrow(TypeError);
  });

  it('throws RangeError when size is 0', () => {
    expect(() => chunkArray([], 0)).toThrow(RangeError);
  });

  it('throws RangeError when size is negative', () => {
    expect(() => chunkArray([], -5)).toThrow(RangeError);
  });

  it('CHUNK_SIZE constant equals 50', () => {
    expect(CHUNK_SIZE).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// fetchEscrowsByContractIds
// ═══════════════════════════════════════════════════════════════════════════════
describe('fetchEscrowsByContractIds', () => {
  afterEach(() => jest.clearAllMocks());

  it('resolves with escrows array when API returns { escrows: [...] }', async () => {
    const escrows = [makeEscrow()];
    mockHttpResponse({ escrows });

    const result = await fetchEscrowsByContractIds(['CDLZ_TEST_001']);
    expect(result).toEqual(escrows);
  });

  it('resolves with bare array when API returns an array directly', async () => {
    const escrows = [makeEscrow(), makeEscrow({ contractId: 'CDLZ_002' })];
    mockHttpResponse(escrows);

    const result = await fetchEscrowsByContractIds(['CDLZ_TEST_001', 'CDLZ_002']);
    expect(result).toEqual(escrows);
  });

  it('rejects when API returns a non-200 status', async () => {
    mockHttpResponse('Not Found', 404);

    await expect(fetchEscrowsByContractIds(['X'])).rejects.toThrow('404');
  });

  it('rejects when the response is not valid JSON', async () => {
    mockHttpResponse('not-json!!');

    await expect(fetchEscrowsByContractIds(['X'])).rejects.toThrow(
      'Failed to parse'
    );
  });

  it('rejects when API returns an unexpected shape', async () => {
    mockHttpResponse({ unexpected: true });

    await expect(fetchEscrowsByContractIds(['X'])).rejects.toThrow(
      'Unexpected TrustlessWork API response shape'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// syncChunk
// ═══════════════════════════════════════════════════════════════════════════════
describe('syncChunk', () => {
  afterEach(() => jest.clearAllMocks());

  it('counts an updated row when RETURNING has rows', async () => {
    const escrow = makeEscrow();
    mockHttpResponse({ escrows: [escrow] });

    // RETURNING fires → row was changed
    db.query.mockResolvedValue({ rows: [{ contract_id: escrow.contractId, inserted: false }] });

    const result = await syncChunk([escrow.contractId]);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 0 });
  });

  it('counts an unchanged row when RETURNING is empty', async () => {
    const escrow = makeEscrow();
    mockHttpResponse({ escrows: [escrow] });

    // RETURNING empty → row was skipped by IS DISTINCT FROM
    db.query.mockResolvedValue({ rows: [] });

    const result = await syncChunk([escrow.contractId]);
    expect(result).toEqual({ updated: 0, unchanged: 1, skipped: 0 });
  });

  it('running sync twice on unchanged data returns updated: 0', async () => {
    const escrow = makeEscrow();

    // Both calls: RETURNING empty (data identical)
    mockHttpResponse({ escrows: [escrow] });
    db.query.mockResolvedValue({ rows: [] });

    const first = await syncChunk([escrow.contractId]);
    expect(first.updated).toBe(0);

    mockHttpResponse({ escrows: [escrow] });
    db.query.mockResolvedValue({ rows: [] });

    const second = await syncChunk([escrow.contractId]);
    expect(second.updated).toBe(0);
  });

  it('isolates a per-row DB error — counts as skipped, others still processed', async () => {
    const good = makeEscrow({ contractId: 'GOOD_001' });
    const bad = makeEscrow({ contractId: 'BAD_002' });
    mockHttpResponse({ escrows: [good, bad] });

    db.query
      .mockResolvedValueOnce({ rows: [{ contract_id: 'GOOD_001' }] }) // good row updated
      .mockRejectedValueOnce(new Error('constraint violation'));       // bad row throws

    const result = await syncChunk(['GOOD_001', 'BAD_002']);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 1 });
  });

  it('skips an escrow missing contractId', async () => {
    mockHttpResponse({ escrows: [{ status: 'funded' }] }); // no contractId

    const result = await syncChunk(['some-id']);
    expect(result).toEqual({ updated: 0, unchanged: 0, skipped: 1 });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns zero counts when API returns an empty escrows array', async () => {
    mockHttpResponse({ escrows: [] });

    const result = await syncChunk(['SOME_ID']);
    expect(result).toEqual({ updated: 0, unchanged: 0, skipped: 0 });
  });

  it('propagates a thrown error when the HTTP call itself fails', async () => {
    const { EventEmitter } = require('events');
    const fakeReq = new EventEmitter();
    fakeReq.setTimeout = jest.fn();
    fakeReq.destroy = jest.fn();
    fakeReq.end = jest.fn(() => {
      process.nextTick(() => fakeReq.emit('error', new Error('ECONNREFUSED')));
    });
    https.request.mockImplementation(() => fakeReq);

    await expect(syncChunk(['X'])).rejects.toThrow('ECONNREFUSED');
  });
});
