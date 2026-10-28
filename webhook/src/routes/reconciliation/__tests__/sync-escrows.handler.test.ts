'use strict'

import { Request, Response } from 'express'
import * as reconciliationService from '../../../services/reconciliation.service'

process.env.SOROBAN_VALIDATION_ENABLED = 'false'

jest.mock('../../../services/reconciliation.service', () => ({
  ...jest.requireActual('../../../services/reconciliation.service'),
  fetchEscrowContractIds: jest.fn(),
  syncEscrowsWithIndexer: jest.fn(),
  validateSorobanDrift: jest.fn(),
  detectStaleEscrows: jest.fn(),
}))

describe('syncEscrowsHandler', () => {
  let syncEscrowsHandler: (req: Request, res: Response) => Promise<Response>

  beforeEach(async () => {
    jest.clearAllMocks()
    process.env.SOROBAN_VALIDATION_ENABLED = 'false'
    ;(reconciliationService.fetchEscrowContractIds as jest.Mock).mockResolvedValue([])
    ;(reconciliationService.syncEscrowsWithIndexer as jest.Mock).mockResolvedValue({
      totalEscrows: 0,
      chunks: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: [],
    })
    ;(reconciliationService.validateSorobanDrift as jest.Mock).mockResolvedValue({
      enabled: false,
      drift: 0,
      corrected: 0,
      unresolved: 0,
      errors: [],
    })
    ;(reconciliationService.detectStaleEscrows as jest.Mock).mockResolvedValue([])
    const module = await import('../sync-escrows.handler')
    syncEscrowsHandler = module.syncEscrowsHandler
  })

  it('returns 200 with zero counts when no escrows are found', async () => {
    const req = {} as Request
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await syncEscrowsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      {
        success: true,
        data: expect.objectContaining({
          totalEscrows: 0,
          sorobanEnabled: false,
          sorobanDrift: 0,
          sorobanCorrected: 0,
        }),
      }
    )
  })

  it('processes chunks successfully when SOROBAN_VALIDATION_ENABLED is false', async () => {
    ;(reconciliationService.fetchEscrowContractIds as jest.Mock).mockResolvedValueOnce([
      'mock_1',
    ])
    ;(reconciliationService.syncEscrowsWithIndexer as jest.Mock).mockResolvedValueOnce({
      totalEscrows: 1,
      chunks: 1,
      updated: 1,
      unchanged: 0,
      skipped: 0,
      errors: [],
    })

    const req = {} as Request
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await syncEscrowsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      {
        success: true,
        data: expect.objectContaining({
          totalEscrows: 1,
          updated: 1,
          sorobanEnabled: false,
          sorobanDrift: 0,
          sorobanCorrected: 0,
        }),
      }
    )
  })

  it('handles fatal database error with 500 status', async () => {
    ;(reconciliationService.fetchEscrowContractIds as jest.Mock).mockRejectedValueOnce(
      new Error('DB connection failed')
    )

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
