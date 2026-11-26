import express from 'express'
import request from 'supertest'
import reportRouter from '../report.route'

jest.mock('../../../middleware/auth.middleware', () => ({
  authMiddleware: (
    _req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction
  ) => next(),
}))

jest.mock('../report.handler', () => ({
  createReportHandler: (_req: import('express').Request, res: import('express').Response) =>
    res.status(201).end(),
}))

describe('apartment report route rate limiting', () => {
  const app = express()
  app.use(express.json())
  app.use(reportRouter)

  it('rejects report requests after the per-IP limit', async () => {
    const reportResponses = await Promise.all(
      Array.from({ length: 30 }, () =>
        request(app)
          .post('/listing-1/reports')
          .send({
            category: 'other',
            details: 'This listing has inaccurate information.',
            clientOpId: '00000000-0000-0000-0000-000000000001',
          })
      )
    )
    expect(reportResponses.every((response) => response.status === 201)).toBe(true)

    const response = await request(app)
      .post('/listing-1/reports')
      .send({
          category: 'other',
          details: 'This listing has inaccurate information.',
          clientOpId: '00000000-0000-0000-0000-000000000001',
      })

    expect(response.status).toBe(429)
  })
})
