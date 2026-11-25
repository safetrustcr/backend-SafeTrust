/**
 * HMAC-SHA256 verification of Trustless Work callbacks on `node:crypto`.
 *
 * Ports the Rust `crates/webhook-verifier` unit tests and the former
 * native/fallback parity suite. The expected `sha256=…` strings were produced
 * by the Rust crate (`hmac` + `sha2`) before it was deleted, so a match here
 * means the TypeScript digest is byte-for-byte the one the addon accepted.
 */

import { verifyHmacSignature, type HmacPayload } from '../hmac-signature'

const SECRET = 'dev-secret'

const RUST_VECTORS: Array<{ name: string; payload: HmacPayload; signature: string }> = [
  {
    name: 'JSON request bytes (funded)',
    payload: Buffer.from('{"contractId":"escrow-1","status":"funded"}'),
    signature: 'sha256=e258ba1e4532f7ffcb94438be44e8a3671a24988a212b0144ba43fc65fae836a',
  },
  {
    name: 'JSON request bytes (disputed)',
    payload: Buffer.from('{"contractId":"escrow-1","status":"disputed"}'),
    signature: 'sha256=70e101385f694bef1bead4c79abcef5d0c6234cde4df2c608c0b1fb0a9bb7f40',
  },
  {
    name: 'invalid UTF-8 bytes',
    payload: Buffer.from([0xff, 0xfe, 0x00, 0x80]),
    signature: 'sha256=f79f4c371c31bea671e2651aac60f3591c8e24864fc4fa5d9d9a1f768e406760',
  },
  {
    name: 'Uint8Array view',
    payload: new Uint8Array([0x7b, 0x7d]),
    signature: 'sha256=754dab469f4dd851a739316cf2e43f8b43dfd232a39f5872c4af7d9f0f6fa7ea',
  },
  {
    name: 'UTF-8 string',
    payload: '{"status":"resolved"}',
    signature: 'sha256=92cb9b423b49eca47a47bd9cf0448c95a370d721d7471723fcc62fc32ce91b96',
  },
  {
    name: 'canonical timestamp.body bytes signed by the middleware',
    payload: Buffer.from('1767225600000.{"status":"funded"}'),
    signature: 'sha256=393ebb24cca86dbfb8797ba7635d2322ded690d96c88846bfd4e01018b09c0b4',
  },
]

describe('verifyHmacSignature — parity with the Rust webhook-verifier', () => {
  it.each(RUST_VECTORS)('accepts the Rust digest for $name', ({ payload, signature }) => {
    expect(verifyHmacSignature(payload, signature, SECRET)).toBe(true)
  })

  it('hashes a Uint8Array view over a larger buffer as only its own bytes', () => {
    const backing = new Uint8Array([0x00, 0x7b, 0x7d, 0x00])
    const view = backing.subarray(1, 3)
    expect(verifyHmacSignature(view, RUST_VECTORS[3].signature, SECRET)).toBe(true)
  })
})

describe('verifyHmacSignature — Rust unit tests (lib.rs)', () => {
  const body = Buffer.from('body')
  const [funded] = RUST_VECTORS

  it('matching_signature_is_valid', () => {
    expect(verifyHmacSignature(funded.payload, funded.signature, SECRET)).toBe(true)
  })

  it('mismatched_signature_returns_false', () => {
    expect(verifyHmacSignature(body, RUST_VECTORS[1].signature, SECRET)).toBe(false)
  })

  it('wrong_secret_returns_false', () => {
    expect(verifyHmacSignature(funded.payload, funded.signature, 'other-secret')).toBe(false)
  })

  it('empty_secret_fails_closed', () => {
    expect(verifyHmacSignature(body, 'sha256=abc', '')).toBe(false)
    expect(verifyHmacSignature(funded.payload, funded.signature, '')).toBe(false)
  })

  it('malformed_signature_returns_false', () => {
    expect(verifyHmacSignature(body, 'not-a-valid-signature', SECRET)).toBe(false)
  })

  it('hashes_non_utf8_payload_bytes', () => {
    const [, , invalidUtf8] = RUST_VECTORS
    expect(verifyHmacSignature(invalidUtf8.payload, invalidUtf8.signature, SECRET)).toBe(true)
  })
})

describe('verifyHmacSignature — fail-closed paths', () => {
  const [funded] = RUST_VECTORS

  it('rejects a truncated, padded or re-cased signature', () => {
    expect(verifyHmacSignature(funded.payload, 'sha256=short', SECRET)).toBe(false)
    expect(verifyHmacSignature(funded.payload, `${funded.signature}0`, SECRET)).toBe(false)
    expect(verifyHmacSignature(funded.payload, funded.signature.toUpperCase(), SECRET)).toBe(false)
    expect(verifyHmacSignature(funded.payload, funded.signature.slice('sha256='.length), SECRET)).toBe(false)
  })

  it('rejects an empty signature and unsupported payload types without throwing', () => {
    expect(verifyHmacSignature(funded.payload, '', SECRET)).toBe(false)
    expect(verifyHmacSignature(undefined as unknown as Buffer, funded.signature, SECRET)).toBe(false)
    expect(verifyHmacSignature(42 as unknown as Buffer, funded.signature, SECRET)).toBe(false)
    expect(verifyHmacSignature(funded.payload, null as unknown as string, SECRET)).toBe(false)
    expect(verifyHmacSignature(funded.payload, funded.signature, undefined as unknown as string)).toBe(false)
  })

  it('compares encoded bytes, so a multi-byte character cannot pass a length check', () => {
    const hex = funded.signature.slice('sha256='.length)
    // Same string length as a real signature, different UTF-8 byte length.
    const forged = `sha256=é${hex.slice(1)}`
    expect(forged.length).toBe(funded.signature.length)
    expect(verifyHmacSignature(funded.payload, forged, SECRET)).toBe(false)
  })
})
