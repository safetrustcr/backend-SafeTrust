import { NextFunction, Request, Response } from 'express'
import { timingSafeEqual } from 'crypto'
import { logger } from '../../middleware/logger'
import { AuthError } from '../../utils/errors'

export function hasuraClaimsEventGuard(req: Request, _res: Response, next: NextFunction): void {
  const secret = process.env.HASURA_EVENT_SECRET
  if (!secret) {
    throw new AuthError('Unauthorized: event secret not configured')
  }

  const provided = req.headers['x-hasura-event-secret']
  const received = Buffer.from(typeof provided === 'string' ? provided : '')
  const expected = Buffer.from(secret)
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    logger.warn('auth.claims_event_secret_rejected')
    throw new AuthError('Unauthorized: invalid event secret')
  }
  next()
}
