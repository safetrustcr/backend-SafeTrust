'use strict';

/**
 * @file src/lib/__tests__/reconciliation-parallel.test.js
 *
 * Unit tests for the parallel chunk-processing integration added alongside the
 * Rust `chunk-processor` addon:
 *   • upsertEscrows        → shared UPSERT loop (counts + per-row isolation)
 *   • syncAllChunks (seq)  → sequential aggregation + chunk-error isolation
 *   • syncChunksParallel   → Rust-path glue, with the addon faked via the test seam
 *   • syncAllChunks (rust) → routes through the addon when RUST_CHUNKS_ENABLED=true,
 *                            and falls back to sequential when the addon is absent
 *
 * The native addon is never loaded here — a fake is injected via the exported
 * test seam so these tests run with zero Rust build.
 */

jest.mock('../../services/db', () => ({ query: jest.fn() }));

// Explicit factory (not bare automock): guarantees `https.request` is a mock fn
// across Node versions — Node's automock of the core `https` module does not
// reliably replace `request` with a jest.fn.
jest.mock('https', () => ({ request: jest.fn() }));
const https = require('https');

const db = require('../../services/db');
const {
  upsertEscrows,
  syncAllChunks,
  syncChunksParallel,
  __setChunkProcessorForTests,
  __resetChunkProcessorForTests,
} = require('../reconciliation');

function makeEscrow(overrides = {}) {
  return {
    contractId: 'C1',
    status: 'funded',
    amount: '100.0000000',
    balance: '50.0000000',
    escrowType: 'single_release',
    roles: { marker: 'M', approver: 'A', releaser: 'R' },
    ...overrides,
  };
}

/** Make https.request return a JSON body — used by the sequential path. */
function mockHttpResponse(body, statusCode = 200) {
  const { EventEmitter } = require('events');
  const fakeRes = new EventEmitter();
  fakeRes.statusCode = statusCode;
  fakeRes.setEncoding = jest.fn();
  const fakeReq = new EventEmitter();
  fakeReq.setTimeout = jest.fn();
  fakeReq.destroy = jest.fn();
  fakeReq.end = jest.fn(() => {
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

afterEach(() => {
  jest.clearAllMocks();
  __resetChunkProcessorForTests();
  delete process.env.RUST_CHUNKS_ENABLED;
  delete process.env.CHUNK_CONCURRENCY;
  delete process.env.CHUNK_TIMEOUT_MS;
});

// ═══════════════════════════════════════════════════════════════════════════════
// upsertEscrows — the shared UPSERT loop
// ═══════════════════════════════════════════════════════════════════════════════
describe('upsertEscrows', () => {
  it('counts updated vs unchanged from the RETURNING result', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ contract_id: 'C1' }] }) // changed → updated
      .mockResolvedValueOnce({ rows: [] }); // no change → unchanged

    const result = await upsertEscrows([
      makeEscrow({ contractId: 'C1' }),
      makeEscrow({ contractId: 'C2' }),
    ]);
    expect(result).toEqual({ updated: 1, unchanged: 1, skipped: 0 });
  });

  it('writes every indexed column (amount, roles, escrowType) verbatim', async () => {
    db.query.mockResolvedValue({ rows: [{ contract_id: 'C1' }] });
    await upsertEscrows([makeEscrow()]);

    const params = db.query.mock.calls[0][1];
    // $1 contract_id, $2 status, $3 amount, $4 balance, $5 marker, $6 approver,
    // $7 releaser, $8 escrow_type
    expect(params).toEqual([
      'C1', 'funded', '100.0000000', '50.0000000', 'M', 'A', 'R', 'single_release',
    ]);
  });

  it('isolates a per-row DB error as skipped', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ contract_id: 'GOOD' }] })
      .mockRejectedValueOnce(new Error('constraint violation'));

    const result = await upsertEscrows([
      makeEscrow({ contractId: 'GOOD' }),
      makeEscrow({ contractId: 'BAD' }),
    ]);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 1 });
  });

  it('skips escrows missing contractId without touching the DB', async () => {
    const result = await upsertEscrows([{ status: 'funded' }]);
    expect(result).toEqual({ updated: 0, unchanged: 0, skipped: 1 });
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// syncChunksParallel — Rust-path glue (addon faked)
// ═══════════════════════════════════════════════════════════════════════════════
describe('syncChunksParallel', () => {
  it('forwards config to the addon and upserts each chunk’s escrows', async () => {
    process.env.CHUNK_CONCURRENCY = '3';
    process.env.CHUNK_TIMEOUT_MS = '1234';

    const processChunksParallel = jest.fn(async () =>
      JSON.stringify([
        { chunk_index: 0, fetched: 1, duration_ms: 10, error: null, escrows: [makeEscrow({ contractId: 'C1' })] },
        { chunk_index: 1, fetched: 1, duration_ms: 12, error: null, escrows: [makeEscrow({ contractId: 'C2' })] },
      ])
    );
    __setChunkProcessorForTests({ processChunksParallel });
    db.query.mockResolvedValue({ rows: [{ contract_id: 'x' }] }); // every row updated

    const chunks = [['C1'], ['C2']];
    const result = await syncChunksParallel(chunks);

    expect(result).toEqual({ updated: 2, unchanged: 0, skipped: 0, errors: [] });

    // Args: chunksJson, apiUrl, apiKey, concurrency, timeoutMs
    const args = processChunksParallel.mock.calls[0];
    expect(JSON.parse(args[0])).toEqual(chunks);
    expect(args[3]).toBe(3);
    expect(args[4]).toBe(1234);
  });

  it('records a failed chunk in errors and still upserts the healthy ones', async () => {
    const processChunksParallel = jest.fn(async () =>
      JSON.stringify([
        { chunk_index: 0, fetched: 0, duration_ms: 5000, error: 'chunk timed out after 5000ms', escrows: [] },
        { chunk_index: 1, fetched: 1, duration_ms: 20, error: null, escrows: [makeEscrow({ contractId: 'C2' })] },
      ])
    );
    __setChunkProcessorForTests({ processChunksParallel });
    db.query.mockResolvedValue({ rows: [{ contract_id: 'C2' }] });

    const result = await syncChunksParallel([['C1'], ['C2']]);
    expect(result.updated).toBe(1);
    expect(result.errors).toEqual(['chunk_0: chunk timed out after 5000ms']);
  });

  it('throws when the addon is unavailable so the caller can fall back', async () => {
    __setChunkProcessorForTests(null); // no addon
    await expect(syncChunksParallel([['C1']])).rejects.toThrow(/not loaded/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// syncAllChunks — path selection
// ═══════════════════════════════════════════════════════════════════════════════
describe('syncAllChunks', () => {
  it('returns zero counts and 0 chunks for an empty id list', async () => {
    const result = await syncAllChunks([]);
    expect(result).toEqual({ chunks: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] });
  });

  it('uses the sequential path by default (flag unset) and isolates a bad chunk', async () => {
    // 60 ids → 2 chunks of [50, 10]. First chunk OK, second chunk HTTP-fails.
    const ids = Array.from({ length: 60 }, (_, i) => `ID_${i}`);

    let call = 0;
    const { EventEmitter } = require('events');
    https.request.mockImplementation((_opts, cb) => {
      const fakeReq = new EventEmitter();
      fakeReq.setTimeout = jest.fn();
      fakeReq.destroy = jest.fn();
      call += 1;
      if (call === 2) {
        // Second chunk: emit a request error → syncChunk rejects → isolated.
        fakeReq.end = jest.fn(() =>
          process.nextTick(() => fakeReq.emit('error', new Error('ECONNREFUSED')))
        );
        return fakeReq;
      }
      const fakeRes = new EventEmitter();
      fakeRes.statusCode = 200;
      fakeRes.setEncoding = jest.fn();
      fakeReq.end = jest.fn(() =>
        process.nextTick(() => {
          fakeRes.emit('data', JSON.stringify({ escrows: [makeEscrow({ contractId: 'ID_0' })] }));
          fakeRes.emit('end');
        })
      );
      cb(fakeRes);
      return fakeReq;
    });
    db.query.mockResolvedValue({ rows: [{ contract_id: 'ID_0' }] });

    const result = await syncAllChunks(ids);
    expect(result.chunks).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^chunk_1:/);
  });

  it('routes through the Rust addon when RUST_CHUNKS_ENABLED=true', async () => {
    process.env.RUST_CHUNKS_ENABLED = 'true';
    const processChunksParallel = jest.fn(async () =>
      JSON.stringify([
        { chunk_index: 0, fetched: 1, duration_ms: 8, error: null, escrows: [makeEscrow({ contractId: 'C1' })] },
      ])
    );
    __setChunkProcessorForTests({ processChunksParallel });
    db.query.mockResolvedValue({ rows: [{ contract_id: 'C1' }] });

    const result = await syncAllChunks(['C1']);
    expect(processChunksParallel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ chunks: 1, updated: 1, unchanged: 0, skipped: 0, errors: [] });
    // The sequential path must not have fired.
    expect(https.request).not.toHaveBeenCalled();
  });

  it('falls back to sequential when the flag is on but the addon is missing', async () => {
    process.env.RUST_CHUNKS_ENABLED = 'true';
    __setChunkProcessorForTests(null); // addon unavailable
    mockHttpResponse({ escrows: [makeEscrow({ contractId: 'C1' })] });
    db.query.mockResolvedValue({ rows: [{ contract_id: 'C1' }] });

    const result = await syncAllChunks(['C1']);
    expect(result).toEqual({ chunks: 1, updated: 1, unchanged: 0, skipped: 0, errors: [] });
    expect(https.request).toHaveBeenCalledTimes(1); // proves sequential ran
  });
});
