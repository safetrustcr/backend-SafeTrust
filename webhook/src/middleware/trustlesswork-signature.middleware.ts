'use strict'

import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'

/**
 * Request populated with the exact request bytes by
 * `express.json({ verify })` upstream in `index.ts`.
 */
interface TrustlessWorkRequest extends Request {
  rawBody: Buffer
}

/**
 * Verifies the `x-trustlesswork-signature` HMAC-SHA256 header TrustlessWork
 * sends on every escrow webhook callback, so a forged POST cannot inject
 * fraudulent escrow state (e.g. a fake `completed`/`funded` status with no
 * real Stellar transaction behind it).
 *
 * Requires `req.rawBody` (a `Buffer` of the exact request bytes) to be
 * populated by `express.json({ verify })` upstream — the HMAC is computed
 * over the raw bytes, not a re-serialized copy of the parsed body, since
 * re-serialization is not guaranteed to reproduce byte-for-byte what
 * TrustlessWork actually signed.
 */
export const verifyTrustlessWorkSignature = (
  req: TrustlessWorkRequest,
  res: Response,
  next: NextFunction
): void => {
  const secret = process.env.TRUSTLESSWORK_WEBHOOK_SECRET
  if (!secret) {
    console.error('[trustlesswork-signature] TRUSTLESSWORK_WEBHOOK_SECRET not set')
    res.status(500).json({ error: 'Webhook secret not configured' })
    return
  }

  const signature = req.headers['x-trustlesswork-signature'] as string
  if (!signature) {
    res.status(401).json({ error: 'Missing x-trustlesswork-signature header' })
    return
  }

  const hmac = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')

  const expected = Buffer.from(`sha256=${hmac}`)
  const received = Buffer.from(signature)

  try {
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      res.status(401).json({ error: 'Invalid webhook signature' })
      return
    }
  } catch {
    res.status(401).json({ error: 'Invalid webhook signature' })
    return
  }

  next()
}

export default verifyTrustlessWorkSignature
