import express from 'express'
import request from 'supertest'
import healthRoutes from '../health.route'
import { getApps } from 'firebase-admin/app'
import { pool } from '../../services/db'

jest.mock('firebase-admin/app', () => ({
  getApps: jest.fn(),
}))

jest.mock('../../services/db', () => ({
  pool: {
    query: jest.fn(),
  },
}))

const mockedGetApps = jest.mocked(getApps)
const mockedPoolQuery = pool.query as jest.Mock
const app = express().use(healthRoutes)

describe('health readiness route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns 503 until Firebase initialization is complete', async () => {
    mockedGetApps.mockReturnValue([])
    mockedPoolQuery.mockResolvedValue({
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [{ '?column?': 1 }],
    })

    const response = await request(app).get('/health/ready')

    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      status: 'not_ready',
      dependencies: { firebase: false, database: true },
    })
    expect(mockedPoolQuery).toHaveBeenCalledWith({
      text: 'SELECT 1',
      query_timeout: 200,
    })
  })

  it('returns 503 when the database is unavailable', async () => {
    mockedGetApps.mockReturnValue([
      { name: '[DEFAULT]' } as ReturnType<typeof getApps>[number],
    ])
    mockedPoolQuery.mockRejectedValue(new Error('database unavailable'))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await request(app).get('/health/ready')

    expect(response.status).toBe(503)
    expect(response.body.dependencies).toEqual({ firebase: true, database: false })
    expect(errorSpy).toHaveBeenCalled()
  })
})
