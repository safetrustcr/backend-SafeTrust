import { runHandler } from '../../__tests__/run-handler'
'use strict'

import { Request, Response } from 'express'
import * as reconciliationService from '../../../services/reconciliation.service'


process.env.SOROBAN_VALIDATION_ENABLED = 'false'

jest.mock('../../../services/reconciliation.service', () => ({

  ...jest.requireActual('../../../services/reconciliation.service'),

  fetchEscrowContractIds: jest.fn(),

  listReconciliationTenants: jest.fn(),

  syncEscrowsWithIndexer: jest.fn(),

  validateSorobanDrift: jest.fn(),

  detectStaleEscrows: jest.fn(),

}))

describe('syncEscrowsHandler', () => {
  let syncEscrowsHandler: (req: Request, res: Response) => Promise<Response>

  beforeEach(async () => {
    jest.clearAllMocks()
    process.env.SOROBAN_VALIDATION_ENABLED = 'false'
    ;(reconciliationService.listReconciliationTenants as jest.Mock).mockResolvedValue(['safetrust'])

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

    await runHandler(syncEscrowsHandler, req, res)

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
      transitions: {
        detected: 1,
        applied: 0,
        duplicates: 0,
        failed: 1,
        errors: ['mock_1: mirror unavailable'],
        failedContractIds: ['mock_1'],
      },
    })

    const req = {} as Request
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await runHandler(syncEscrowsHandler, req, res)

    expect(reconciliationService.syncEscrowsWithIndexer).toHaveBeenCalledWith(['mock_1'], {
      applyTransitions: true,
      tenantId: 'safetrust',
    })
    expect(reconciliationService.validateSorobanDrift).toHaveBeenCalledWith(
      ['mock_1'],
      'testnet',
      { skipStatusCorrectionFor: ['mock_1'], tenantId: 'safetrust' }
    )

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

  it('syncs escrows for every tenant, including a non-default tenant', async () => {
    ;(reconciliationService.listReconciliationTenants as jest.Mock).mockResolvedValue([
      'safetrust',
      'hotel_industry',
    ])
    ;(reconciliationService.fetchEscrowContractIds as jest.Mock).mockImplementation(
      async (tenantId: string) =>
        tenantId === 'hotel_industry' ? ['hotel_1'] : ['mock_1']
    )
    ;(reconciliationService.syncEscrowsWithIndexer as jest.Mock)
      .mockResolvedValueOnce({
        totalEscrows: 1,
        chunks: 1,
        updated: 1,
        unchanged: 0,
        skipped: 0,
        errors: [],
      })
      .mockResolvedValueOnce({
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

    expect(reconciliationService.fetchEscrowContractIds).toHaveBeenCalledWith(
      'hotel_industry'
    )
    expect(reconciliationService.syncEscrowsWithIndexer).toHaveBeenCalledWith(
      ['hotel_1'],
      {
        applyTransitions: true,
        tenantId: 'hotel_industry',
      }
    )
    expect(reconciliationService.detectStaleEscrows).toHaveBeenCalledWith(
      7,
      'hotel_industry'
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      {
        success: true,
        data: expect.objectContaining({
          totalEscrows: 2,
          updated: 2,
        }),
      }
    )
  })
  it('handles fatal database error with 500 status', async () => {
    // Tenant discovery failure is fatal (500): a per-tenant failure is

    // recorded in the summary instead, so the rejection must come from

    // listReconciliationTenants, not from a single tenant's sync.

    ;(reconciliationService.listReconciliationTenants as jest.Mock).mockRejectedValueOnce(

      new Error('DB connection failed')

    )


    const req = {} as Request
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response

    await runHandler(syncEscrowsHandler, req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Internal server error',
      })
    )
  })
  it('records a per-tenant failure and still syncs the next tenant', async () => {
    ;(reconciliationService.listReconciliationTenants as jest.Mock).mockResolvedValue([
      'safetrust',
      'hotel_industry',
    ])
    ;(reconciliationService.syncEscrowsWithIndexer as jest.Mock)
      .mockRejectedValueOnce(new Error('indexer unavailable'))
      .mockResolvedValueOnce({
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
          errors: 1,
        }),
      }
    )
  })
})
