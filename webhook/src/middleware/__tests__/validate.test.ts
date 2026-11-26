import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { validate, type RequestDataSource } from '../validate'
import {
  apartmentListQuerySchema,
  approveMilestoneSchema,
  cancelReservationSchema,
  confirmTransactionSchema,
  createApartmentSchema,
  createBidRequestSchema,
  createEscrowClaimSchema,
  createListingReportSchema,
  createReservationSchema,
  createWalletChallengeSchema,
  disputeEscrowSchema,
  emptyBodySchema,
  escrowInitializationSchema,
  fundEscrowSchema,
  reconciliationSyncSchema,
  releaseFundsSchema,
  resolveDisputeSchema,
  reservationListQuerySchema,
  syncWalletSchema,
  updateBidRequestSchema,
  verifyWalletChallengeSchema,
} from '../../validation'
import reservationsRouter from '../../routes/reservations'

interface InvalidRouteCase {
  route: string
  schema: z.ZodType
  source: RequestDataSource
  payload: unknown
  query?: string
}

const invalidRoutes: InvalidRouteCase[] = [
  { route: 'POST /api/auth/sync-user', schema: emptyBodySchema, source: 'body', payload: [] },
  { route: 'POST /api/auth/sync-wallet', schema: syncWalletSchema, source: 'body', payload: {} },
  { route: 'POST /api/auth/wallet/challenge', schema: createWalletChallengeSchema, source: 'body', payload: {} },
  { route: 'POST /api/auth/wallet/verify', schema: verifyWalletChallengeSchema, source: 'body', payload: {} },
  { route: 'GET /api/apartments', schema: apartmentListQuerySchema, source: 'query', payload: {}, query: '?minPrice=bad' },
  { route: 'POST /api/apartments', schema: createApartmentSchema, source: 'body', payload: {} },
  { route: 'POST /api/apartments/:id/reports', schema: createListingReportSchema, source: 'body', payload: {} },
  { route: 'POST /api/bid-requests', schema: createBidRequestSchema, source: 'body', payload: {} },
  { route: 'PATCH /api/bid-requests/:id', schema: updateBidRequestSchema, source: 'body', payload: {} },
  { route: 'POST /api/reservations', schema: createReservationSchema, source: 'body', payload: {} },
  { route: 'GET /api/reservations', schema: reservationListQuerySchema, source: 'query', payload: {}, query: '?role=admin' },
  { route: 'POST /api/reservations/:id/cancel', schema: cancelReservationSchema, source: 'body', payload: { reason: 7 } },
  { route: 'POST /api/escrow-claims/:escrowId', schema: createEscrowClaimSchema, source: 'body', payload: { body: 'short', clientOpId: '33333333-3333-4333-8333-333333333333' } },
  {
    route: 'POST /api/escrows/initialize',
    schema: escrowInitializationSchema,
    source: 'body',
    payload: {
      contract_id: 'contract-1',
      marker: 'marker',
      approver: 'approver',
      releaser: 'releaser',
      amount: 0,
      escrow_type: 'single_release',
    },
  },
  { route: 'POST /api/escrows/confirm-transaction', schema: confirmTransactionSchema, source: 'body', payload: {} },
  { route: 'POST /api/escrows/fund', schema: fundEscrowSchema, source: 'body', payload: {} },
  { route: 'POST /api/escrows/approve-milestone', schema: approveMilestoneSchema, source: 'body', payload: {} },
  { route: 'POST /api/escrows/release-funds', schema: releaseFundsSchema, source: 'body', payload: {} },
  { route: 'POST /api/escrows/dispute', schema: disputeEscrowSchema, source: 'body', payload: {} },
  { route: 'POST /api/escrows/resolve-dispute', schema: resolveDisputeSchema, source: 'body', payload: {} },
  { route: 'POST /reconciliation/sync-escrows', schema: reconciliationSyncSchema, source: 'body', payload: [] },
]

describe('request validation middleware', () => {
  it.each(invalidRoutes)('returns the canonical 400 format for $route', async ({
    schema,
    source,
    payload,
    query,
  }) => {
    const app = express()
    app.use(express.json())
    app.use(validate(schema, source))
    app.use((_req, res) => res.status(204).end())

    const response = source === 'query'
      ? await request(app).get(`/${query ?? ''}`)
      : await request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(payload))

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: 'validation_failed',
      fields: expect.any(Object),
    })
    expect(Object.keys(response.body.fields).length).toBeGreaterThan(0)
  })

  it('uses the first message for each field path', async () => {
    const app = express()
    app.use(express.json())
    app.post('/', validate(z.object({ name: z.string().min(1) })), (_req, res) => {
      res.sendStatus(204)
    })

    const response = await request(app).post('/').send({ name: '' })
    expect(response.body).toEqual({
      error: 'validation_failed',
      fields: { name: expect.any(String) },
    })
  })

  it('passes validated body and query data to downstream handlers', async () => {
    const app = express()
    app.use(express.json())
    app.post('/body', validate(syncWalletSchema), (req, res) => res.json(req.body))
    app.get('/query', validate(apartmentListQuerySchema, 'query'), (req, res) => res.json(req.query))

    const bodyResponse = await request(app).post('/body').send({
      wallet_address: 'wallet-1',
      chain_type: 'ETH',
    })
    const queryResponse = await request(app).get('/query?page=2&limit=10')

    expect(bodyResponse.body).toMatchObject({ is_primary: false })
    expect(queryResponse.body).toEqual({ page: '2', limit: '10' })
  })

  it('mounts reservation creation validation before the handler', async () => {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.context = { uid: 'validation-test-user', tenantId: 'safetrust', roles: ['guest'] }
      req.user = { uid: 'validation-test-user', role: 'guest', roles: ['guest'] }
      next()
    })
    app.use('/api/reservations', reservationsRouter)

    const response = await request(app).post('/api/reservations').send({})

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: 'validation_failed',
      fields: expect.any(Object),
    })
  })

  it('accepts cancellation requests with no body', async () => {
    const app = express()
    app.use(express.json())
    app.post('/cancel', validate(cancelReservationSchema), (req, res) => res.json(req.body))

    const response = await request(app).post('/cancel')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({})
  })

  it('rejects boolean funding amounts instead of coercing them to numbers', async () => {
    const app = express()
    app.use(express.json())
    app.post('/', validate(fundEscrowSchema), (_req, res) => res.sendStatus(204))

    const response = await request(app)
      .post('/')
      .send({ contractId: 'contract-1', signer: 'signer-1', amount: true })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('validation_failed')
    expect(response.body.fields.amount).toEqual(expect.any(String))
  })

  it('accepts PostgreSQL UUID syntax with zero-filled version and variant bits', () => {
    const result = createBidRequestSchema.safeParse({
      apartment_id: '00000000-0000-0000-0000-000000000001',
      proposed_price: 4500,
      desired_move_in: '2026-06-01T00:00:00Z',
    })

    expect(result.success).toBe(true)
  })
})
