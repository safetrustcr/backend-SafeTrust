'use strict'

import express from 'express'
import request from 'supertest'
import router from '../index'
import * as escrowService from '../../services/escrow.service'
import { errorHandler } from '../../middleware/error-handler'

jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: jest.fn((req, _res, next) => {
    req.context = { uid: 'test-user', tenantId: 'safetrust', roles: [] }
    next()
  }),
}))

jest.mock('../../services/escrow.service', () => ({
  ...jest.requireActual('../../services/escrow.service'),
  isEscrowParty: jest.fn(),
}))

const mockedIsEscrowParty = escrowService.isEscrowParty as jest.MockedFunction<
  typeof escrowService.isEscrowParty
>

describe('confirm transaction parent router', () => {
  const previousWebhookSecret = process.env.TRUSTLESSWORK_WEBHOOK_SECRET

  beforeEach(() => {
    delete process.env.TRUSTLESSWORK_WEBHOOK_SECRET
    jest.clearAllMocks()
  })

  afterAll(() => {
    if (previousWebhookSecret === undefined) {
      delete process.env.TRUSTLESSWORK_WEBHOOK_SECRET
    } else {
      process.env.TRUSTLESSWORK_WEBHOOK_SECRET = previousWebhookSecret
    }
  })

  it('reaches Firebase-authenticated confirmation without a webhook signature', async () => {
    mockedIsEscrowParty.mockResolvedValue(false)
    const app = express()
    app.use(express.json())
    app.use(router)
    app.use(errorHandler)

    const response = await request(app)
      .post('/api/escrows/confirm-transaction')
      .send({
        escrowId: 'contract-1',
        action: 'fund',
        txHash: 'a'.repeat(64),
      })

    expect(response.status).toBe(403)
    expect(response.body.error).toBe('Caller is not a recognized party on this escrow')
    expect(mockedIsEscrowParty).toHaveBeenCalledWith('test-user', 'contract-1', 'safetrust')
  })
})
