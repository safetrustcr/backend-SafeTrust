import express from 'express'
import request from 'supertest'
import walletChallengeRouter from '../wallet-challenge.route'

jest.mock('../wallet-challenge.handler', () => ({
  createWalletChallengeHandler: (_req: import('express').Request, res: import('express').Response) =>
    res.status(202).end(),
  verifyWalletChallengeHandler: (_req: import('express').Request, res: import('express').Response) =>
    res.status(202).end(),
}))

describe('wallet challenge route rate limiting', () => {
  const app = express()
  app.use(express.json())
  app.use(walletChallengeRouter)

  it('shares the limit between challenge and verification requests', async () => {
    const challengeResponses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post('/challenge').send({ wallet_address: 'GABC' })
      )
    )
    expect(challengeResponses.every((response) => response.status === 202)).toBe(true)

    const response = await request(app)
      .post('/verify')
      .send({
        challengeId: '00000000-0000-0000-0000-000000000001',
        signature: 'a'.repeat(128),
      })

    expect(response.status).toBe(429)
  })
})
