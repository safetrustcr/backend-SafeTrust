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
const TIMESTAMP_PATTERN = /^[0-9]+$/

// Native Rust HMAC verifier (Neon). Compiled by `npm run build:rust`.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyHmacSignature } = require('../../../crates/webhook-verifier') as {
  verifyHmacSignature: (
    payload: Buffer | Uint8Array,
    signature: string,
    secret: string
  ) => boolean
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function parseMillisTimestamp(value: string): number | null {
  if (!TIMESTAMP_PATTERN.test(value)) {
    return null
  }
  const timestamp = Number(value)
  if (!Number.isSafeInteger(timestamp)) {
    return null
  }
  return timestamp
}

function canonicalSignedPayload(timestamp: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from('.'), rawBody])
}

/**
 * Verifies the `x-trustlesswork-signature` HMAC-SHA256 header TrustlessWork
 * sends on every escrow webhook callback, so a forged POST cannot inject
 * fraudulent escrow state (e.g. a fake `completed`/`funded` status with no
 * real Stellar transaction behind it).
 *
 * HMAC is computed over the canonical bytes `timestamp + '.' + rawBody`
 * (`req.rawBody` is the exact request bytes populated by
 * `express.json({ verify })` upstream). The raw body is hashed as bytes,
 * not as a UTF-8 string, so invalid UTF-8 cannot change the digest.
 *
 * `x-trustlesswork-timestamp` must be a complete decimal unix-epoch
 * millisecond value and is rejected outside a ±5 minute replay window.
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

  const parsedTimestamp = parseMillisTimestamp(timestamp)
  if (parsedTimestamp === null) {
    res.status(401).json({ error: 'Webhook timestamp expired or invalid' })
    return
  }

  const age = Date.now() - parsedTimestamp
  if (age > REPLAY_WINDOW_MS || age < -REPLAY_WINDOW_MS) {
    res.status(401).json({ error: 'Webhook timestamp expired or invalid' })
    return
  }

  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0)
  const payload = canonicalSignedPayload(timestamp, rawBody)

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
