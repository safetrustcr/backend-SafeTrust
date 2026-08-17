'use strict'

import { Request, Response, NextFunction } from 'express'

/**
 * Request populated with the exact request bytes by
 * `express.json({ verify })` upstream in `index.ts`.
 */
interface TrustlessWorkRequest extends Request {
  rawBody: Buffer
}

const REPLAY_WINDOW_MS = 5 * 60 * 1_000

// Native Rust HMAC verifier (Neon). Compiled by `npm run build:rust`.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyHmacSignature } = require('../../../crates/webhook-verifier') as {
  verifyHmacSignature: (payload: string, signature: string, secret: string) => boolean
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

/**
 * Verifies the `x-trustlesswork-signature` HMAC-SHA256 header TrustlessWork
 * sends on every escrow webhook callback, so a forged POST cannot inject
 * fraudulent escrow state (e.g. a fake `completed`/`funded` status with no
 * real Stellar transaction behind it).
 *
 * HMAC is computed over `req.rawBody` (the exact request bytes populated by
 * `express.json({ verify })` upstream) — not a re-serialized copy of the
 * parsed body, since re-serialization is not guaranteed to reproduce
 * byte-for-byte what TrustlessWork actually signed.
 *
 * `x-trustlesswork-timestamp` (unix epoch milliseconds) is required and
 * rejected when older than 5 minutes to limit replay of captured requests.
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

  const signature = headerValue(req.headers['x-trustlesswork-signature'])
  if (!signature) {
    res.status(401).json({ error: 'Missing x-trustlesswork-signature header' })
    return
  }

  const timestamp = headerValue(req.headers['x-trustlesswork-timestamp'])
  if (!timestamp) {
    res.status(401).json({ error: 'Missing TrustlessWork signature headers' })
    return
  }

  const age = Date.now() - parseInt(timestamp, 10)
  if (isNaN(age) || age > REPLAY_WINDOW_MS) {
    res.status(401).json({ error: 'Webhook timestamp expired or invalid' })
    return
  }

  const payload = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : ''

  let isValid: boolean
  try {
    isValid = verifyHmacSignature(payload, signature, secret)
  } catch (err) {
    console.error('[trustlesswork-signature] Rust verifier error:', err)
    res.status(500).json({ error: 'Signature verification failed' })
    return
  }

  if (!isValid) {
    res.status(401).json({ error: 'Invalid webhook signature' })
    return
  }

  next()
}

export default verifyTrustlessWorkSignature
