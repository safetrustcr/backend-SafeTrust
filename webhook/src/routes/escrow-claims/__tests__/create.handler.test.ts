'use strict'

import { Response } from 'express'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'
import { createEscrowClaim } from '../../../services/escrow-claims.service'
import { createClaimHandler } from '../create.handler'
import { runHandler } from '../../__tests__/run-handler'

jest.mock('../../../services/escrow-claims.service', () => ({ createEscrowClaim: jest.fn() }))

const ESCROW_ID = '11111111-1111-4111-8111-111111111111'
const OP_ID = '33333333-3333-4333-8333-333333333333'
const CLAIM_ID = '44444444-4444-4444-8444-444444444444'
const BODY = 'The deposit deduction was wrong.'

const claim = {
  id: CLAIM_ID,
  escrow_id: ESCROW_ID,
  reservation_id: 'res-1',
  author_id: 'guest-1',
  body: BODY,
  status: 'submitted',
  client_op_id: OP_ID,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

function makeReq(overrides: Record<string, unknown> = {}): AuthenticatedRequest {
  return {
    user: { uid: 'guest-1' },
    params: { escrowId: ESCROW_ID },
    body: { body: BODY, clientOpId: OP_ID },
    ...overrides,
  } as unknown as AuthenticatedRequest
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    set: jest.fn().mockReturnThis(),
  } as unknown as Response & { status: jest.Mock; json: jest.Mock; set: jest.Mock }
}

describe('createClaimHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createEscrowClaim as jest.Mock).mockResolvedValue({ kind: 'created', claim })
  })

  it('validates input before calling the service', async () => {
    const invalid = makeRes()
    await runHandler(createClaimHandler, makeReq({ params: { escrowId: 'nope' } }), invalid)
    expect(invalid.status).toHaveBeenCalledWith(400)
    expect(invalid.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'INVALID_CLAIM_REQUEST' }))

    const noUser = makeRes()
    await runHandler(createClaimHandler, makeReq({ user: undefined }), noUser)
    expect(noUser.status).toHaveBeenCalledWith(401)
    expect(createEscrowClaim).not.toHaveBeenCalled()
  })

  it('creates a claim and passes the normalized body to the service', async () => {
    const res = makeRes()
    await runHandler(createClaimHandler, makeReq({
      body: { body: `  ${BODY}  `, clientOpId: OP_ID },
    }), res)
    expect(createEscrowClaim).toHaveBeenCalledWith({
      escrowId: ESCROW_ID, authorId: 'guest-1', body: BODY, clientOpId: OP_ID,
    })
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      id: CLAIM_ID, status: 'submitted', createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it.each([
    ['not-participant', 404, expect.objectContaining({ success: false, error: 'ESCROW_NOT_FOUND' })],
    ['not-released', 409, expect.objectContaining({ success: false, error: 'ESCROW_NOT_RELEASED' })],
    ['conflict-without-row', 500, expect.objectContaining({ success: false, error: 'Internal server error' })],
  ] as const)('maps service result %s to the existing response', async (kind, status, body) => {
    ;(createEscrowClaim as jest.Mock).mockResolvedValue({ kind })
    const res = makeRes()
    await runHandler(createClaimHandler, makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(status)
    expect(res.json).toHaveBeenCalledWith(body)
  })

  it('returns the original idempotent claim or rejects a reused operation id', async () => {
    ;(createEscrowClaim as jest.Mock).mockResolvedValue({ kind: 'already-used', claim })
    const same = makeRes()
    await runHandler(createClaimHandler, makeReq(), same)
    expect(same.status).toHaveBeenCalledWith(200)
    expect(same.json).toHaveBeenCalledWith({
      id: CLAIM_ID, status: 'submitted', createdAt: '2026-01-01T00:00:00.000Z',
    })

    ;(createEscrowClaim as jest.Mock).mockResolvedValue({
      kind: 'already-used', claim: { ...claim, escrow_id: '22222222-2222-4222-8222-222222222222' },
    })
    const reused = makeRes()
    await runHandler(createClaimHandler, makeReq(), reused)
    expect(reused.status).toHaveBeenCalledWith(409)
    expect(reused.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'CLIENT_OP_ID_REUSED' }))
  })

  it('sets Retry-After when the service reports the claim rate limit', async () => {
    ;(createEscrowClaim as jest.Mock).mockResolvedValue({ kind: 'rate-limited' })
    const res = makeRes()
    await runHandler(createClaimHandler, makeReq(), res)
    expect(res.set).toHaveBeenCalledWith('Retry-After', '86400')
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'CLAIM_RATE_LIMITED' }))
  })

  it('returns 500 when the service fails', async () => {
    ;(createEscrowClaim as jest.Mock).mockRejectedValue(new Error('database unavailable'))
    const res = makeRes()
    await runHandler(createClaimHandler, makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Internal server error' }))
  })
})
