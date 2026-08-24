'use strict'

import { Request, Response } from 'express'
import { syncEscrowsHandler } from '../sync-escrows.handler'
import db from '../../../services/db'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { syncAllChunks, findStaleEscrows } = require('../../../lib/reconciliation')

jest.mock('../../../services/db', () => ({
  query: jest.fn(),
}))

jest.mock('../../../services/hasura', () => ({
  hasuraRequest: jest.fn(),
}))

jest.mock('../../../lib/reconciliation', () => ({
  chunkArray: jest.fn((arr) => [arr]),
  syncAllChunks: jest.fn(),
  syncChunk: jest.fn(),
  findStaleEscrows: jest.fn(),
  CHUNK_SIZE: 50,
}))

describe('syncEscrowsHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SOROBAN_VALIDATION_ENABLED = 'false'
  })

  it('returns 200 with zero counts when no escrows are found', async () => {
    ;(db.query as jest.Mock).mockResolvedValueOnce({ rows: [] })

    const req = {} as Request
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await syncEscrowsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        totalEscrows: 0,
        sorobanEnabled: false,
        sorobanDrift: 0,
        sorobanCorrected: 0,
      })
    )
  })

  it('processes chunks successfully when SOROBAN_VALIDATION_ENABLED is false', async () => {
    ;(db.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          contract_id: 'mock_1',
          status: 'ACTIVE',
          balance: '100',
          marker: 'm',
          approver: 'a',
        },
      ],
    })
    syncAllChunks.mockResolvedValueOnce({
      chunks: 1,
      updated: 1,
      unchanged: 0,
      skipped: 0,
      errors: [],
    })
    findStaleEscrows.mockResolvedValueOnce([])

    const req = {} as Request
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await syncEscrowsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        totalEscrows: 1,
        updated: 1,
        sorobanEnabled: false,
        sorobanDrift: 0,
        sorobanCorrected: 0,
      })
    )
  })

  it('handles fatal database error with 500 status', async () => {
    ;(db.query as jest.Mock).mockRejectedValueOnce(new Error('DB connection failed'))

    const req = {} as Request
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await syncEscrowsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Reconciliation failed',
      })
    )
  })
})
