'use strict'

import request from 'supertest'
import express from 'express'
import confirmTransactionRoute from '../confirm-transaction.route'
import * as confirmationService from '../../../services/confirmation.service'
import * as escrowService from '../../../services/escrow.service'
import { errorHandler } from '../../../middleware/error-handler'

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}))

jest.mock('../../../services/confirmation.service', () => ({
  ...jest.requireActual('../../../services/confirmation.service'),
  processHelperSubmission: jest.fn(),
  processExternalSubmission: jest.fn(),
}))

jest.mock('../../../services/escrow.service', () => ({
  ...jest.requireActual('../../../services/escrow.service'),
  isEscrowParty: jest.fn(),
}))

const mockedHelper = confirmationService.processHelperSubmission as jest.MockedFunction<
  typeof confirmationService.processHelperSubmission
>
const mockedExternal = confirmationService.processExternalSubmission as jest.MockedFunction<
  typeof confirmationService.processExternalSubmission
>
const mockedIsEscrowParty = escrowService.isEscrowParty as jest.MockedFunction<
  typeof escrowService.isEscrowParty
>

describe('POST /api/escrows/confirm-transaction', () => {
  const VALID_TX_HASH = 'b'.repeat(64)
  const ESCROW_ID = 'contract-xyz-123'
  let app: express.Express

  beforeEach(() => {
    jest.clearAllMocks()
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.context = {
        uid: 'test-user-123',
        tenantId: 'safetrust',
        roles: [],
      }
      next()
    })
    app.use(confirmTransactionRoute)
    app.use(errorHandler)
    mockedIsEscrowParty.mockResolvedValue(true)
  })

  it('rejects client signing without submission', async () => {
    const res = await request(app)
      .post('/api/escrows/confirm-transaction')
      .send({
        signingOnly: true,
        escrowId: ESCROW_ID,
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Client-side wallet signing cannot advance escrow status')
  })

  it('validates required fields: missing escrowId', async () => {
    const res = await request(app)
      .post('/api/escrows/confirm-transaction')
      .send({
        action: 'deploy',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('escrowId is required')
  })

  it('validates required fields: invalid action', async () => {
    const res = await request(app)
      .post('/api/escrows/confirm-transaction')
      .send({
        escrowId: ESCROW_ID,
        action: 'invalid_action',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('action must be either "deploy" or "fund"')
  })

  it('handles Helper submission successfully (Path A)', async () => {
    mockedHelper.mockResolvedValueOnce({
      success: true,
      stage: 'confirmed',
      txHash: VALID_TX_HASH,
      escrowId: ESCROW_ID,
      action: 'deploy',
      network: 'testnet',
      submissionPath: 'helper',
      ledger: 45678,
      twIndexed: true,
    })

    const res = await request(app)
      .post('/api/escrows/confirm-transaction')
      .send({
        submissionPath: 'helper',
        signedXdr: 'AAAA_VALID_SIGNED_XDR',
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.stage).toBe('confirmed')
    expect(res.body.txHash).toBe(VALID_TX_HASH)
    expect(res.body.ledger).toBe(45678)
  })

  it('handles External submission successfully (Path B)', async () => {
    mockedExternal.mockResolvedValueOnce({
      success: true,
      stage: 'confirmed',
      txHash: VALID_TX_HASH,
      escrowId: ESCROW_ID,
      action: 'fund',
      network: 'testnet',
      submissionPath: 'external',
      ledger: 56789,
      twIndexed: true,
    })

    const res = await request(app)
      .post('/api/escrows/confirm-transaction')
      .send({
        submissionPath: 'external',
        txHash: VALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'fund',
        network: 'testnet',
        isTWGenerated: true,
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.stage).toBe('confirmed')
    expect(res.body.txHash).toBe(VALID_TX_HASH)
    expect(res.body.twIndexed).toBe(true)
  })

  it('returns 400 when external submission fails validation or guardrails', async () => {
    mockedExternal.mockResolvedValueOnce({
      success: false,
      stage: 'pending_confirmation',
      txHash: VALID_TX_HASH,
      escrowId: ESCROW_ID,
      action: 'deploy',
      network: 'testnet',
      submissionPath: 'external',
      error: 'Guardrail: indexer/update-from-txHash only permitted for TW-generated XDRs',
    })

    const res = await request(app)
      .post('/api/escrows/confirm-transaction')
      .send({
        submissionPath: 'external',
        txHash: VALID_TX_HASH,
        escrowId: ESCROW_ID,
        action: 'deploy',
        network: 'testnet',
        isTWGenerated: false,
      })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('Guardrail')
  })
})
