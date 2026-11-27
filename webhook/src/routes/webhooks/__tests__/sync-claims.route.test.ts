import express from 'express'
import request from 'supertest'
import { errorHandler } from '../../../middleware/error-handler'
import { syncClaims } from '../../../services/claims'
import claimsRouter from '../sync-claims.route'

jest.mock('../../../services/claims', () => ({ syncClaims: jest.fn() }))

const SECRET = 'test-event-secret'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use(claimsRouter)
  app.use(errorHandler)
  return app
}

function insertEvent(uid: string) {
  return {
    event: {
      op: 'INSERT',
      data: { new: { user_id: uid } },
    },
  }
}

describe('POST /webhooks/sync-claims', () => {
  const originalSecret = process.env.HASURA_EVENT_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.HASURA_EVENT_SECRET = SECRET
    ;(syncClaims as jest.Mock).mockResolvedValue(true)
  })

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.HASURA_EVENT_SECRET
    } else {
      process.env.HASURA_EVENT_SECRET = originalSecret
    }
  })

  it('rejects a request without the event secret', async () => {
    const response = await request(makeApp()).post('/sync-claims').send(insertEvent('uid-1'))

    expect(response.status).toBe(401)
    expect(syncClaims).not.toHaveBeenCalled()
  })

  it('rejects a wrong event secret', async () => {
    const response = await request(makeApp())
      .post('/sync-claims')
      .set('x-hasura-event-secret', 'wrong-secret')
      .send(insertEvent('uid-1'))

    expect(response.status).toBe(401)
    expect(syncClaims).not.toHaveBeenCalled()
  })

  it('fails closed when the event secret is not configured', async () => {
    delete process.env.HASURA_EVENT_SECRET

    const response = await request(makeApp())
      .post('/sync-claims')
      .set('x-hasura-event-secret', SECRET)
      .send(insertEvent('uid-1'))

    expect(response.status).toBe(401)
    expect(syncClaims).not.toHaveBeenCalled()
  })

  it('syncs claims for an insert event using the new row', async () => {
    const response = await request(makeApp())
      .post('/sync-claims')
      .set('x-hasura-event-secret', SECRET)
      .send(insertEvent('host-user-1'))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ claimsUpdated: true })
    expect(syncClaims).toHaveBeenCalledWith('host-user-1')
  })

  it('syncs claims for a delete event using the old row', async () => {
    ;(syncClaims as jest.Mock).mockResolvedValueOnce(false)

    const response = await request(makeApp())
      .post('/sync-claims')
      .set('x-hasura-event-secret', SECRET)
      .send({
        event: { op: 'DELETE', data: { old: { user_id: 'former-host' } } },
      })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ claimsUpdated: false })
    expect(syncClaims).toHaveBeenCalledWith('former-host')
  })

  it('rejects an event without a user_id', async () => {
    const response = await request(makeApp())
      .post('/sync-claims')
      .set('x-hasura-event-secret', SECRET)
      .send({ event: { op: 'INSERT', data: { new: {} } } })

    expect(response.status).toBe(400)
    expect(syncClaims).not.toHaveBeenCalled()
  })
})
