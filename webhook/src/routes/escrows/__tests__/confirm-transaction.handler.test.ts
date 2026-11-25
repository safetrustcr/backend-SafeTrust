import { Request, Response } from 'express'
import { confirmTransactionHandler } from '../confirm-transaction.handler'

describe('confirmTransactionHandler Network & Input Validation', () => {
  const originalEnv = process.env.STELLAR_NETWORK

  beforeEach(() => {
    process.env.STELLAR_NETWORK = 'testnet'
  })

  afterAll(() => {
    process.env.STELLAR_NETWORK = originalEnv
  })

  function createMockRes(): {
    res: Response
    status: jest.Mock
    json: jest.Mock
  } {
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })
    const res = { status, json } as unknown as Response
    return { res, status, json }
  }

  it('rejects request when client specifies mismatched network', async () => {
    process.env.STELLAR_NETWORK = 'testnet'
    const req = {
      body: {
        escrowId: 'escrow-1',
        action: 'fund',
        network: 'mainnet', // Mismatch!
        txHash: 'a'.repeat(64),
      },
    } as Request<any, any, any>

    const { res, status, json } = createMockRes()

    await confirmTransactionHandler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Network mismatch'),
      })
    )
  })

  it('rejects when escrowId is missing', async () => {
    const req = {
      body: {
        action: 'fund',
        txHash: 'a'.repeat(64),
      },
    } as Request<any, any, any>

    const { res, status, json } = createMockRes()

    await confirmTransactionHandler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith({ error: 'escrowId is required' })
  })

  it('rejects when action is invalid', async () => {
    const req = {
      body: {
        escrowId: 'escrow-1',
        action: 'invalid_action',
        txHash: 'a'.repeat(64),
      },
    } as Request<any, any, any>

    const { res, status, json } = createMockRes()

    await confirmTransactionHandler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith({ error: 'action must be either "deploy" or "fund"' })
  })

  it('rejects when signingOnly is true', async () => {
    const req = {
      body: {
        escrowId: 'escrow-1',
        action: 'fund',
        signingOnly: true,
      },
    } as Request<any, any, any>

    const { res, status, json } = createMockRes()

    await confirmTransactionHandler(req, res)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Client-side wallet signing cannot advance escrow status'),
      })
    )
  })
})
