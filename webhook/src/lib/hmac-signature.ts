'use strict'

/**
 * @file webhook/src/lib/hmac-signature.ts
 * @description HMAC-SHA256 check of Trustless Work callback signatures, on
 * `node:crypto`.
 *
 * Ported from the former Rust `crates/webhook-verifier` addon (whose Node
 * fallback was already this code); the parity vectors live on in
 * `lib/__tests__/hmac-signature.test.ts`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Payload bytes accepted by the verifier. */
export type HmacPayload = Buffer | Uint8Array | string

/**
 * Normalize a payload to the exact bytes that are hashed.
 *
 * Strings are UTF-8 encoded once. `Buffer` and `Uint8Array` are used as raw
 * bytes, so invalid UTF-8 never gets re-encoded on the way to the digest.
 */
function payloadBytes(payload: HmacPayload): Buffer | null {
  if (Buffer.isBuffer(payload)) return payload
  if (payload instanceof Uint8Array) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
  }
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8')
  return null
}

/**
 * Verify a TrustlessWork HMAC-SHA256 webhook signature of the form
 * `sha256=<lowercase hex digest>`.
 *
 * Fail-closed by contract: a missing/empty secret, a malformed signature, an
 * unsupported payload type, or any comparison error returns `false`. It never
 * throws and never returns `true` on an error path. The comparison is
 * constant-time over equal-length inputs.
 */
export function verifyHmacSignature(
  payload: HmacPayload,
  signature: string,
  secret: string
): boolean {
  try {
    if (typeof secret !== 'string' || secret.length === 0) return false
    if (typeof signature !== 'string' || signature.length === 0) return false

    const bytes = payloadBytes(payload)
    if (!bytes) return false

    const expected = `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`

    // Compare the encoded bytes, not JS string code units. A length check
    // keeps timingSafeEqual from throwing on mismatched buffers.
    const expectedBytes = Buffer.from(expected, 'utf8')
    const receivedBytes = Buffer.from(signature, 'utf8')
    if (receivedBytes.length !== expectedBytes.length) return false

    return timingSafeEqual(receivedBytes, expectedBytes)
  } catch {
    return false
  }
}
