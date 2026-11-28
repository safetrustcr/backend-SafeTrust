export {};
'use strict';

/**
 * @file src/lib/__tests__/reconciliation.test.ts
 *
 * Unit tests for src/lib/reconciliation.ts
 *
 * Strategy
 * ─────────
 *  • All external I/O (DB + HTTP) is mocked — no live database or network needed.
 *  • chunkArray  → pure function, tested exhaustively.
 *  • syncChunk   → DB + HTTP mocked; verifies counts and per-row error isolation.
 *  • fetchEscrowsByContractIds → HTTP mocked; verifies both API response shapes.
 *  • findStaleEscrows → DB mocked; verifies query params and contract_id mapping.
 */

// ─── Mock the DB service before requiring the module under test ───────────────
jest.mock('../../db/pool', () => ({
  query: jest.fn(),
}));

// ─── Mock global.fetch so no real network calls fire ──────────────────────────
// The HTTP boundary moved to the shared fetch client
// (`clients/http-client.ts`), so the mock seam is `global.fetch`, not Node's
// `https` module. `mockHttpResponse` installs a jest.fn there; tests read
// it via `global.fetch` / `mockFetch()` and `jest.clearAllMocks()` resets it.

const db = require('../../db/pool');
const {
  chunkArray,
  syncChunk,
  fetchEscrowsByContractIds,
  findStaleEscrows,
  CHUNK_SIZE,
} = require('../reconciliation');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal escrow object as the TrustlessWork indexer would return it.
 */
/** A Trustless Work V1 indexer escrow (GetEscrowsFromIndexerResponse). */
function makeEscrow(overrides = {}) {
  return {
    contractId: 'CDLZ_TEST_001',
    type: 'single-release',
    amount: 100,
    balance: 100,
    fundedBy: 'GGUEST',
    flags: { approved: false, disputed: false, released: false, resolved: false },
    milestones: [{ description: 'Check-in', status: 'pending', approved: false }],
    roles: {
      approver: 'APPROVER',
      serviceProvider: 'MARKER',
      platformAddress: 'PLATFORM',
      releaseSigner: 'RELEASER',
      disputeResolver: 'RESOLVER',
      receiver: 'MARKER',
    },
    ...overrides,
  };
}

/**
 * Make `global.fetch` resolve with a fake response carrying the given body
 * and statusCode. The fetch client only touches `ok`, `status`, `json()`
 * and `text()` on success responses; on error it reads `text()`.
 */
function mockHttpResponse(body: unknown, statusCode = 200) {
  const isOk = statusCode >= 200 && statusCode < 300;
  const mockFetch = jest.fn(async () => ({
    ok: isOk,
    status: statusCode,
    json: async () => {
      if (typeof body === 'string') {
        // `response.json()` on a non-JSON string throws, like the real API.
        throw new SyntaxError(`Unexpected token in JSON at position 0 — body starts with ${JSON.stringify(body.slice(0, 10))}`);
      }
      return body;
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? '')),
  }));
  global.fetch = mockFetch as unknown as typeof fetch;
  return mockFetch;
}

// ═══════════════════════════════════════════════════════════════════════════════
// chunkArray
// ═══════════════════════════════════════════════════════════════════════════════
describe('chunkArray — O(n) array partitioning', () => {
  // Big O: chunkArray is O(n) time and O(n) space.
  // For n elements and chunk size k: produces ⌈n/k⌉ chunks.

  describe('core functionality', () => {
    it('splits an array into correct chunk sizes', () => {
      const result = chunkArray([1, 2, 3, 4, 5], 2);
      expect(result).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('returns a single chunk when array is smaller than size', () => {
      const result = chunkArray(['a', 'b'], 50);
      expect(result).toEqual([['a', 'b']]);
    });

    it('handles chunk size equal to array length', () => {
      expect(chunkArray([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
    });

    it('CHUNK_SIZE constant equals 50', () => {
      expect(CHUNK_SIZE).toBe(50);
    });
  });

  describe('boundary conditions and Big O correctness', () => {
    it('empty array → empty result (n=0)', () => {
      expect(chunkArray([], 50)).toEqual([]);
    });

    it('single element → one chunk of one (n=1)', () => {
      expect(chunkArray(['A'], 50)).toEqual([['A']]);
    });

    it('exactly 49 elements → 1 chunk (n < CHUNK_SIZE)', () => {
      const arr = Array.from({ length: 49 }, (_, i) => `C${i}`);
      const result = chunkArray(arr, 50);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(49);
    });

    it('exactly 50 elements → 1 chunk (n = CHUNK_SIZE boundary)', () => {
      const arr = Array.from({ length: 50 }, (_, i) => `C${i}`);
      const result = chunkArray(arr, 50);
      expect(result).toHaveLength(1); // ⌈50/50⌉ = 1
      expect(result[0]).toHaveLength(50);
    });

    it('exactly 51 elements → 2 chunks (n = CHUNK_SIZE + 1)', () => {
      const arr = Array.from({ length: 51 }, (_, i) => `C${i}`);
      const result = chunkArray(arr, 50);
      expect(result).toHaveLength(2); // ⌈51/50⌉ = 2
      expect(result[0]).toHaveLength(50); // first chunk full
      expect(result[1]).toHaveLength(1); // remainder
    });

    it('100 elements → 2 chunks of 50 (n = 2 * CHUNK_SIZE)', () => {
      const arr = Array.from({ length: 100 }, (_, i) => `C${i}`);
      const result = chunkArray(arr, 50);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(50);
      expect(result[1]).toHaveLength(50);
    });

    it('101 elements → 3 chunks (n = 2 * CHUNK_SIZE + 1)', () => {
      const arr = Array.from({ length: 101 }, (_, i) => `C${i}`);
      expect(chunkArray(arr, 50)).toHaveLength(3); // ⌈101/50⌉ = 3
    });

    it('127 elements → correct chunk count (n = 127)', () => {
      const arr = Array.from({ length: 127 }, (_, i) => `C${i}`);
      const result = chunkArray(arr, 50);
      expect(result).toHaveLength(3); // ⌈127/50⌉ = 3
      expect(result[0]).toHaveLength(50);
      expect(result[1]).toHaveLength(50);
      expect(result[2]).toHaveLength(27); // remainder
    });

    it('no elements are lost across all chunks (data integrity)', () => {
      const arr = Array.from({ length: 127 }, (_, i) => `C${i}`);
      const chunks = chunkArray(arr, 50);
      const flattened = chunks.flat();
      expect(flattened).toHaveLength(127);
      expect(flattened).toEqual(arr);
    });

    it('chunk size 1 → n chunks (degenerate case)', () => {
      const arr = ['A', 'B', 'C'];
      expect(chunkArray(arr, 1)).toEqual([['A'], ['B'], ['C']]);
    });
  });

  describe('error handling', () => {
    it('throws TypeError when arr is not an array', () => {
      expect(() => chunkArray('not-an-array', 10)).toThrow(TypeError);
    });

    it('throws RangeError when size is 0', () => {
      expect(() => chunkArray([], 0)).toThrow(RangeError);
    });

    it('throws RangeError when size is negative', () => {
      expect(() => chunkArray([], -5)).toThrow(RangeError);
    });

    it('throws RangeError when size is not an integer', () => {
      expect(() => chunkArray([1, 2, 3], 1.5)).toThrow(RangeError);
    });
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
      'invalid JSON'
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

  it('writes the status derived from V1 flags and the V1 role names', async () => {
    const escrow = makeEscrow({ flags: { released: true } });
    mockHttpResponse({ escrows: [escrow] });
    db.query.mockResolvedValue({ rows: [{ contract_id: escrow.contractId, inserted: false }] });

    await syncChunk([escrow.contractId]);

    const [, params] = db.query.mock.calls[0];
    // contract_id, status, amount, balance, marker, approver, releaser, escrow_type, network
    expect(params.slice(0, 8)).toEqual([
      'CDLZ_TEST_001', 'completed', 100, 100, 'MARKER', 'APPROVER', 'RELEASER', 'single_release',
    ]);
  });

  it('writes valid records when a sibling record is malformed', async () => {
    const good = makeEscrow({ contractId: 'GOOD_001' });
    const broken = makeEscrow({ contractId: 'BROKEN_002', milestones: [null] });
    mockHttpResponse({ escrows: [good, broken] });
    db.query.mockResolvedValue({ rows: [{ contract_id: 'GOOD_001', inserted: false }] });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await syncChunk(['GOOD_001', 'BROKEN_002']);

    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 1 });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1][0]).toBe('GOOD_001');
    const logged = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('invalid_indexer_escrow'));
    expect(JSON.parse(logged!)).toMatchObject({ contractId: 'BROKEN_002', reason: 'milestones[0] is not an object' });
    warn.mockRestore();
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
    mockHttpResponse({ escrows: [{ flags: {} }] }); // no contractId

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
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(syncChunk(['X'])).rejects.toThrow('ECONNREFUSED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// findStaleEscrows — O(log n + k) indexed stale detection
// ═══════════════════════════════════════════════════════════════════════════════
describe('findStaleEscrows', () => {
  afterEach(() => jest.clearAllMocks());

  it('defaults staleDays to 7 and returns mapped contract_ids', async () => {
    db.query.mockResolvedValue({
      rows: [{ contract_id: 'STALE_001' }, { contract_id: 'STALE_002' }],
    });

    const result = await findStaleEscrows();

    expect(result).toEqual(['STALE_001', 'STALE_002']);
    expect(db.query).toHaveBeenCalledTimes(1);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/updated_at\s*<\s*NOW\(\)\s*-\s*\(\$1 \* INTERVAL '1 day'\)/i);
    expect(sql).toMatch(/status NOT IN \('completed', 'resolved', 'cancelled'\)/i);
    expect(sql).toMatch(/tenant_id = 'safetrust'/i);
    expect(params).toEqual([7]);
  });

  it('forwards a custom staleDays parameter', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const result = await findStaleEscrows(14);

    expect(result).toEqual([]);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), [14]);
  });

  it('returns an empty array when no stale escrows exist', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await expect(findStaleEscrows(7)).resolves.toEqual([]);
  });

  it('rejects non-positive staleDays values', async () => {
    await expect(findStaleEscrows(0)).rejects.toThrow(/positive number/i);
    await expect(findStaleEscrows(-3)).rejects.toThrow(/positive number/i);
    await expect(findStaleEscrows(NaN)).rejects.toThrow(/positive number/i);
    expect(db.query).not.toHaveBeenCalled();
  });
});
