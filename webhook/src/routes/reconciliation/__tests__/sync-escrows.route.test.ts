'use strict'

import { Request, Response, NextFunction } from 'express'
import { hasuraSecretGuard } from '../sync-escrows.route'

jest.mock('../sync-escrows.handler', () => ({
  syncEscrowsHandler: jest.fn(),
}))

const TEST_SECRET = 'test-event-secret'

function mockReq(headers: Record<string, string | undefined> = {}): Request {
  return { headers } as unknown as Request
}

function mockRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response
}

describe('hasuraSecretGuard', () => {
  const originalSecret = process.env.HASURA_EVENT_SECRET

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.HASURA_EVENT_SECRET
    } else {
      process.env.HASURA_EVENT_SECRET = originalSecret
    }
    jest.clearAllMocks()
  })

  it('returns 401 when the secret is configured and the header is missing', () => {
    process.env.HASURA_EVENT_SECRET = TEST_SECRET
    const req = mockReq()
    const res = mockRes()
    const next = jest.fn() as unknown as NextFunction

    hasuraSecretGuard(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: invalid event secret' })
  })

  it('returns 401 when the secret is configured and the header is wrong', () => {
    process.env.HASURA_EVENT_SECRET = TEST_SECRET
    const req = mockReq({ 'x-hasura-event-secret': 'wrong-secret-value' })
    const res = mockRes()
    const next = jest.fn() as unknown as NextFunction

    hasuraSecretGuard(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: invalid event secret' })
  })

  it('calls next when the secret is configured and the header matches', () => {
    process.env.HASURA_EVENT_SECRET = TEST_SECRET
    const req = mockReq({ 'x-hasura-event-secret': TEST_SECRET })
    const res = mockRes()
    const next = jest.fn() as unknown as NextFunction

    hasuraSecretGuard(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  it('calls next when no secret is configured (open dev mode)', () => {
    delete process.env.HASURA_EVENT_SECRET
    const req = mockReq()
    const res = mockRes()
    const next = jest.fn() as unknown as NextFunction

    hasuraSecretGuard(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })
})
