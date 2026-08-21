'use strict';

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}));

jest.mock('../../../lib/reconciliation', () => ({
  chunkArray: jest.fn((arr) => [arr]),
  syncChunk: jest.fn(),
  findStaleEscrows: jest.fn(),
  CHUNK_SIZE: 50,
}));

const { syncEscrowsHandler } = require('../sync-escrows.handler');
const db = require('../../../services/db');
const { syncChunk, findStaleEscrows } = require('../../../lib/reconciliation');

describe('syncEscrowsHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SOROBAN_VALIDATION_ENABLED = 'false';
  });

  it('returns 200 with zero counts when no escrows are found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await syncEscrowsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        totalEscrows: 0,
        sorobanEnabled: false,
        sorobanDrift: 0,
        sorobanCorrected: 0,
      })
    );
  });

  it('processes chunks successfully when SOROBAN_VALIDATION_ENABLED is false', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        {
          contract_id: 'mock_1',
          status: 'ACTIVE',
          balance: '100',
          marker: 'm',
          approver: 'a',
        },
      ],
    });
    syncChunk.mockResolvedValueOnce({ updated: 1, unchanged: 0, skipped: 0 });
    findStaleEscrows.mockResolvedValueOnce([]);

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await syncEscrowsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        totalEscrows: 1,
        updated: 1,
        sorobanEnabled: false,
        sorobanDrift: 0,
        sorobanCorrected: 0,
      })
    );
  });

  it('handles fatal database error with 500 status', async () => {
    db.query.mockRejectedValueOnce(new Error('DB connection failed'));

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await syncEscrowsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Reconciliation failed',
      })
    );
  });
});
