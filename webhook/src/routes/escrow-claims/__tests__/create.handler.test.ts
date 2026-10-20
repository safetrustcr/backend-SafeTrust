'use strict'

import { Response } from 'express'
import { createClaimHandler } from '../create.handler'
import { pool } from '../../../services/db'
import { AuthenticatedRequest } from '../../../middleware/auth.middleware'

jest.mock('../../../services/db', () => ({
  pool: {
    connect: jest.fn(),
  },
}))

const ESCROW_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ESCROW_ID = '22222222-2222-4222-8222-222222222222'
const OP_ID = '33333333-3333-4333-8333-333333333333'
const CLAIM_ID = '44444444-4444-4444-8444-444444444444'
const BODY = 'The deposit deduction was wrong.'

const claimRow = (overrides: Record<string, unknown> = {}) => ({
  id: CLAIM_ID,
  escrow_id: ESCROW_ID,
  reservation_id: 'res-1',
  author_id: 'guest-1',
  body: BODY,
  status: 'submitted',
  client_op_id: OP_ID,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

interface Script {
  participation?: unknown[]
  existing?: unknown[]
  recent?: number
  insert?: unknown[]
  reselect?: unknown[]
}

describe('createClaimHandler', () => {
  let mockClient: { query: jest.Mock; release: jest.Mock }

  function script(s: Script) {
    let existingCalls = 0
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FOR SHARE OF r')) return { rows: s.participation ?? [] }
      if (sql.includes('client_op_id = $2') && sql.includes('SELECT')) {
        existingCalls += 1
        if (existingCalls > 1) return { rows: s.reselect ?? [] }
        return { rows: s.existing ?? [] }
      }
      if (sql.includes('count(*)')) return { rows: [{ count: String(s.recent ?? 0) }] }
      if (sql.includes('INSERT INTO safetrust.escrow_claims')) return { rows: s.insert ?? [] }
      return { rows: [] }
    })
  }

  const released = [{ reservation_id: 'res-1', status: 'completed' }]

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

  const sqls = () => mockClient.query.mock.calls.map((c) => c[0] as string)

  let errorSpy: jest.SpyInstance

  afterEach(() => {
    errorSpy.mockRestore()
  })

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.clearAllMocks()
    mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() }
    ;(pool.connect as jest.Mock).mockResolvedValue(mockClient)
  })

  it('returns 201 when the claim is created', async () => {
    script({ participation: released, insert: [claimRow()] })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      id: CLAIM_ID,
      status: 'submitted',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(sqls().some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true)
    expect(sqls()).toContain('COMMIT')
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('stores the trimmed body and the reservation id', async () => {
    script({ participation: released, insert: [claimRow()] })
    await createClaimHandler(
      makeReq({ body: { body: `  ${BODY}  `, clientOpId: OP_ID } }),
      makeRes()
    )
    const call = mockClient.query.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO safetrust.escrow_claims')
    )
    expect(call?.[1]).toEqual([ESCROW_ID, 'res-1', 'guest-1', BODY, OP_ID])
  })

  it('returns 200 with the original claim for the same clientOpId', async () => {
    script({ participation: released, existing: [claimRow()] })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      id: CLAIM_ID,
      status: 'submitted',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(sqls().some((s) => s.includes('INSERT INTO'))).toBe(false)
  })

  it('returns 200 for the same clientOpId even at the daily limit', async () => {
    script({ participation: released, existing: [claimRow()], recent: 5 })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.status).not.toHaveBeenCalledWith(429)
  })

  it('returns 200 when the re-select after a lost race finds the claim', async () => {
    script({ participation: released, insert: [], reselect: [claimRow()] })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('returns 500 when the re-select after a lost race finds nothing', async () => {
    script({ participation: released, insert: [], reselect: [] })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' })
    expect(sqls()).toContain('ROLLBACK')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('returns 409 when the re-select after a lost race finds another escrow', async () => {
    script({
      participation: released,
      insert: [],
      reselect: [claimRow({ escrow_id: OTHER_ESCROW_ID })],
    })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'CLIENT_OP_ID_REUSED' })
    expect(sqls()).toContain('ROLLBACK')
  })

  it('counts code points, not UTF-16 units, for the body length', async () => {
    script({ participation: released, insert: [claimRow()] })
    const ok = makeRes()
    await createClaimHandler(
      makeReq({ body: { body: '\u{1F600}'.repeat(1000), clientOpId: OP_ID } }),
      ok
    )
    expect(ok.status).toHaveBeenCalledWith(201)

    const tooLong = makeRes()
    await createClaimHandler(
      makeReq({ body: { body: '\u{1F600}'.repeat(2001), clientOpId: OP_ID } }),
      tooLong
    )
    expect(tooLong.status).toHaveBeenCalledWith(400)
    expect(tooLong.json).toHaveBeenCalledWith({ error: 'INVALID_CLAIM_BODY' })
  })

  it('returns 409 CLIENT_OP_ID_REUSED when the clientOpId belongs to another escrow', async () => {
    script({ participation: released, existing: [claimRow({ escrow_id: OTHER_ESCROW_ID })] })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'CLIENT_OP_ID_REUSED' })
  })

  it('returns 404 ESCROW_NOT_FOUND when the caller does not participate', async () => {
    script({ participation: [] })
    const res = makeRes()
    await createClaimHandler(makeReq({ user: { uid: 'stranger' } }), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'ESCROW_NOT_FOUND' })
    expect(sqls()).toContain('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('returns the same 404 when the escrow does not exist', async () => {
    script({ participation: [] })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'ESCROW_NOT_FOUND' })
  })

  it('returns 409 ESCROW_NOT_RELEASED when the reservation is not completed', async () => {
    script({ participation: [{ reservation_id: 'res-1', status: 'escrow_funded' }] })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'ESCROW_NOT_RELEASED' })
  })

  it.each([
    ['9 characters', 'a'.repeat(9)],
    ['2001 characters', 'a'.repeat(2001)],
    ['only whitespace', ' '.repeat(20)],
    ['not a string', 12345],
  ])('returns 400 INVALID_CLAIM_BODY for a body with %s', async (_label, body) => {
    const res = makeRes()
    await createClaimHandler(makeReq({ body: { body, clientOpId: OP_ID } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_CLAIM_BODY' })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('accepts a body of exactly 10 and exactly 2000 characters', async () => {
    for (const body of ['a'.repeat(10), 'a'.repeat(2000)]) {
      script({ participation: released, insert: [claimRow()] })
      const res = makeRes()
      await createClaimHandler(makeReq({ body: { body, clientOpId: OP_ID } }), res)
      expect(res.status).toHaveBeenCalledWith(201)
    }
  })

  it('returns 400 INVALID_CLAIM_REQUEST for a malformed escrowId or clientOpId', async () => {
    const res1 = makeRes()
    await createClaimHandler(makeReq({ params: { escrowId: 'nope' } }), res1)
    expect(res1.status).toHaveBeenCalledWith(400)
    expect(res1.json).toHaveBeenCalledWith({ error: 'INVALID_CLAIM_REQUEST' })

    const res2 = makeRes()
    await createClaimHandler(makeReq({ body: { body: BODY, clientOpId: 'nope' } }), res2)
    expect(res2.status).toHaveBeenCalledWith(400)
    expect(res2.json).toHaveBeenCalledWith({ error: 'INVALID_CLAIM_REQUEST' })
  })

  it('returns 429 with Retry-After on the sixth claim', async () => {
    script({ participation: released, recent: 5 })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.set).toHaveBeenCalledWith('Retry-After', '86400')
    expect(res.json).toHaveBeenCalledWith({ error: 'CLAIM_RATE_LIMITED' })
  })

  it('allows the fifth claim', async () => {
    script({ participation: released, recent: 4, insert: [claimRow()] })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('returns 401 without a uid', async () => {
    const res = makeRes()
    await createClaimHandler(makeReq({ user: undefined }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('returns 500 and rolls back when the database throws', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FOR SHARE OF r')) throw new Error('db down')
      return { rows: [] }
    })
    const res = makeRes()
    await createClaimHandler(makeReq(), res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'INTERNAL_ERROR' })
    expect(sqls()).toContain('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalled()
  })
})
