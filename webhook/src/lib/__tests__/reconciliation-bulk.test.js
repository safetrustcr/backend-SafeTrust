'use strict';

/**
 * @file src/lib/__tests__/reconciliation-bulk.test.js
 *
 * Unit tests for the Rust bulk-upsert integration:
 *   • upsertEscrowsRowByRow  — original per-row path (counts + isolation)
 *   • upsertEscrowsBulk      — Rust glue, addon faked via the test seam
 *   • upsertEscrowBatch      — path selection on RUST_BULK_UPSERT_ENABLED, plus
 *                              fallback to row-by-row when the bulk path fails
 *   • buildConnectionString  — URL-encoded libpq string from POSTGRES_* env
 *
 * The native addon is never loaded here; a fake is injected via the exported
 * test seam so these run with zero Rust build.
 */

jest.mock('../../services/db', () => ({ query: jest.fn() }));

const db = require('../../services/db');
const {
  upsertEscrowsRowByRow,
  upsertEscrowsBulk,
  upsertEscrowBatch,
  buildConnectionString,
  __setBulkUpsertForTests,
  __resetBulkUpsertForTests,
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

const OLD_ENV = { ...process.env };
beforeEach(() => {
  // buildConnectionString now requires credentials; give the bulk-path tests a
  // default pair (individual tests override or delete them as needed).
  process.env.POSTGRES_USER = 'u';
  process.env.POSTGRES_PASSWORD = 'p';
});
afterEach(() => {
  jest.clearAllMocks();
  __resetBulkUpsertForTests();
  process.env = { ...OLD_ENV };
});

// ═══════════════════════════════════════════════════════════════════════════════
// upsertEscrowsRowByRow — original path
// ═══════════════════════════════════════════════════════════════════════════════
describe('upsertEscrowsRowByRow', () => {
  it('counts updated vs unchanged from RETURNING', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ contract_id: 'C1' }] }) // changed
      .mockResolvedValueOnce({ rows: [] }); // unchanged
    const result = await upsertEscrowsRowByRow([
      makeEscrow({ contractId: 'C1' }),
      makeEscrow({ contractId: 'C2' }),
    ]);
    expect(result).toEqual({ updated: 1, unchanged: 1, skipped: 0 });
  });

  it('isolates a per-row error and skips a record missing contractId', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ contract_id: 'GOOD' }] })
      .mockRejectedValueOnce(new Error('constraint violation'));
    const result = await upsertEscrowsRowByRow([
      makeEscrow({ contractId: 'GOOD' }),
      makeEscrow({ contractId: 'BAD' }),
      { status: 'funded' }, // no contractId
    ]);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// upsertEscrowsBulk — Rust glue (addon faked)
// ═══════════════════════════════════════════════════════════════════════════════
describe('upsertEscrowsBulk', () => {
  it('maps escrow fields to the addon row shape with matching defaults', async () => {
    const bulkUpsertEscrows = jest.fn(async () =>
      JSON.stringify({ rows_affected: 1, unchanged: 0, duration_ms: 3 })
    );
    __setBulkUpsertForTests({ bulkUpsertEscrows });
    process.env.POSTGRES_HOST = 'db';
    process.env.POSTGRES_USER = 'u';
    process.env.POSTGRES_PASSWORD = 'p';

    // amount absent -> "0"; roles absent -> "" defaults.
    await upsertEscrowsBulk([{ contractId: 'C1', status: 'funded' }]);

    const [updatesJson, connString] = bulkUpsertEscrows.mock.calls[0];
    expect(JSON.parse(updatesJson)).toEqual([
      {
        contract_id: 'C1',
        status: 'funded',
        amount: '0',
        balance: '0',
        marker: '',
        approver: '',
        releaser: '',
        escrow_type: 'single_release',
      },
    ]);
    expect(connString).toContain('@db:');
  });

  it('returns rows_affected as updated and the addon unchanged count', async () => {
    const bulkUpsertEscrows = jest.fn(async () =>
      JSON.stringify({ rows_affected: 3, unchanged: 2, duration_ms: 5 })
    );
    __setBulkUpsertForTests({ bulkUpsertEscrows });

    const escrows = Array.from({ length: 5 }, (_, i) => makeEscrow({ contractId: `C${i}` }));
    const result = await upsertEscrowsBulk(escrows);
    expect(result).toEqual({ updated: 3, unchanged: 2, skipped: 0 });
  });

  it('filters records missing contractId and counts them as skipped', async () => {
    const bulkUpsertEscrows = jest.fn(async () =>
      JSON.stringify({ rows_affected: 1, unchanged: 0, duration_ms: 2 })
    );
    __setBulkUpsertForTests({ bulkUpsertEscrows });

    const result = await upsertEscrowsBulk([makeEscrow({ contractId: 'C1' }), { status: 'x' }]);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 1 });
    // Only the valid record is sent to the addon.
    expect(JSON.parse(bulkUpsertEscrows.mock.calls[0][0])).toHaveLength(1);
  });

  it('does not call the addon when every record is malformed', async () => {
    const bulkUpsertEscrows = jest.fn();
    __setBulkUpsertForTests({ bulkUpsertEscrows });
    const result = await upsertEscrowsBulk([{ status: 'x' }, {}]);
    expect(result).toEqual({ updated: 0, unchanged: 0, skipped: 2 });
    expect(bulkUpsertEscrows).not.toHaveBeenCalled();
  });

  it('throws when the addon is unavailable so the caller can fall back', async () => {
    __setBulkUpsertForTests(null);
    await expect(upsertEscrowsBulk([makeEscrow()])).rejects.toThrow(/not loaded/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// upsertEscrowBatch — path selection + fallback
// ═══════════════════════════════════════════════════════════════════════════════
describe('upsertEscrowBatch', () => {
  it('uses row-by-row by default (flag unset)', async () => {
    const bulkUpsertEscrows = jest.fn();
    __setBulkUpsertForTests({ bulkUpsertEscrows });
    db.query.mockResolvedValue({ rows: [{ contract_id: 'C1' }] });

    const result = await upsertEscrowBatch([makeEscrow({ contractId: 'C1' })]);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 0 });
    expect(bulkUpsertEscrows).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('uses the bulk path when the flag is on and the addon loads', async () => {
    process.env.RUST_BULK_UPSERT_ENABLED = 'true';
    const bulkUpsertEscrows = jest.fn(async () =>
      JSON.stringify({ rows_affected: 1, unchanged: 0, duration_ms: 4 })
    );
    __setBulkUpsertForTests({ bulkUpsertEscrows });

    const result = await upsertEscrowBatch([makeEscrow({ contractId: 'C1' })]);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 0 });
    expect(bulkUpsertEscrows).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('falls back to row-by-row when the bulk statement throws', async () => {
    process.env.RUST_BULK_UPSERT_ENABLED = 'true';
    const bulkUpsertEscrows = jest.fn(async () => {
      throw new Error('Bulk upsert failed: connection refused');
    });
    __setBulkUpsertForTests({ bulkUpsertEscrows });
    db.query.mockResolvedValue({ rows: [{ contract_id: 'C1' }] });

    const result = await upsertEscrowBatch([makeEscrow({ contractId: 'C1' })]);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 0 });
    expect(bulkUpsertEscrows).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledTimes(1); // row-by-row ran after the failure
  });

  it('falls back to row-by-row when the flag is on but the addon is missing', async () => {
    process.env.RUST_BULK_UPSERT_ENABLED = 'true';
    __setBulkUpsertForTests(null);
    db.query.mockResolvedValue({ rows: [{ contract_id: 'C1' }] });

    const result = await upsertEscrowBatch([makeEscrow({ contractId: 'C1' })]);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 0 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('empty batch returns zero counts without touching either path', async () => {
    process.env.RUST_BULK_UPSERT_ENABLED = 'true';
    const bulkUpsertEscrows = jest.fn();
    __setBulkUpsertForTests({ bulkUpsertEscrows });
    const result = await upsertEscrowBatch([]);
    expect(result).toEqual({ updated: 0, unchanged: 0, skipped: 0 });
    expect(bulkUpsertEscrows).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('falls back to row-by-row when DB credentials are not configured', async () => {
    process.env.RUST_BULK_UPSERT_ENABLED = 'true';
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;
    const bulkUpsertEscrows = jest.fn();
    __setBulkUpsertForTests({ bulkUpsertEscrows });
    db.query.mockResolvedValue({ rows: [{ contract_id: 'C1' }] });

    const result = await upsertEscrowBatch([makeEscrow({ contractId: 'C1' })]);
    expect(result).toEqual({ updated: 1, unchanged: 0, skipped: 0 });
    // buildConnectionString threw before the addon was reached.
    expect(bulkUpsertEscrows).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildConnectionString
// ═══════════════════════════════════════════════════════════════════════════════
describe('buildConnectionString', () => {
  it('builds a libpq URL from POSTGRES_* env', () => {
    process.env.POSTGRES_HOST = 'pg';
    process.env.POSTGRES_PORT = '5433';
    process.env.POSTGRES_DB = 'safetrust';
    process.env.POSTGRES_USER = 'svc';
    process.env.POSTGRES_PASSWORD = 'secret';
    expect(buildConnectionString()).toBe('postgresql://svc:secret@pg:5433/safetrust');
  });

  it('URL-encodes user and password with special characters', () => {
    process.env.POSTGRES_HOST = 'pg';
    process.env.POSTGRES_PORT = '5432';
    process.env.POSTGRES_DB = 'db';
    process.env.POSTGRES_USER = 'a@b';
    process.env.POSTGRES_PASSWORD = 'p@ss:w/rd';
    expect(buildConnectionString()).toBe(
      'postgresql://a%40b:p%40ss%3Aw%2Frd@pg:5432/db'
    );
  });

  it('throws when POSTGRES_USER or POSTGRES_PASSWORD is missing (no default creds)', () => {
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;
    expect(() => buildConnectionString()).toThrow(/POSTGRES_USER and POSTGRES_PASSWORD/);

    process.env.POSTGRES_USER = 'svc';
    expect(() => buildConnectionString()).toThrow(/POSTGRES_USER and POSTGRES_PASSWORD/);
  });
});
