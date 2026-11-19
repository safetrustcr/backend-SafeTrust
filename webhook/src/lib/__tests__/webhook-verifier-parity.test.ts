import crypto from 'crypto'

type Verifier = (
  payload: Buffer | Uint8Array | string,
  signature: string,
  secret: string
) => boolean

// Use require so the test tsconfig's rootDir does not pull the crate source
// into the webhook compile. `npm test` runs build:tooling first, which emits
// fallback.js beside the TypeScript source.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fallback = require('../../../../crates/webhook-verifier/fallback') as {
  verifyHmacSignature: Verifier
}

/**
 * Load the compiled addon directly (not the package entrypoint, which would
 * silently resolve to the fallback when the binary is absent). The parity
 * suite is skipped when the addon has not been built, so `npm test` still
 * works without a Rust toolchain.
 */
let native: Verifier | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  native = require('../../../../crates/webhook-verifier/index.node')
    .verifyHmacSignature as Verifier
} catch {
  native = null
}

const SECRET = 'dev-secret'

function sign(secret: string, payload: Buffer): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
}

const vectors: Array<{ name: string; payload: Buffer | Uint8Array | string; bytes: Buffer }> = [
  {
    name: 'JSON request bytes',
    payload: Buffer.from(JSON.stringify({ contractId: 'escrow-1', status: 'disputed' })),
    bytes: Buffer.from(JSON.stringify({ contractId: 'escrow-1', status: 'disputed' })),
  },
  {
    name: 'invalid UTF-8 bytes',
    payload: Buffer.from([0xff, 0xfe, 0x00, 0x80]),
    bytes: Buffer.from([0xff, 0xfe, 0x00, 0x80]),
  },
  {
    name: 'Uint8Array view',
    payload: new Uint8Array([0x7b, 0x7d]),
    bytes: Buffer.from([0x7b, 0x7d]),
  },
  {
    name: 'UTF-8 string',
    payload: '{"status":"resolved"}',
    bytes: Buffer.from('{"status":"resolved"}', 'utf8'),
  },
]

describe('webhook-verifier Node fallback', () => {
  it.each(vectors)('verifies $name with the same digest', ({ payload, bytes }) => {
    expect(fallback.verifyHmacSignature(payload, sign(SECRET, bytes), SECRET)).toBe(true)
  })

  it('returns false for every comparison error path', () => {
    const payload = Buffer.from('body')
    const good = sign(SECRET, payload)

    expect(fallback.verifyHmacSignature(payload, good, '')).toBe(false)
    expect(fallback.verifyHmacSignature(payload, good, 'other-secret')).toBe(false)
    expect(fallback.verifyHmacSignature(payload, 'sha256=short', SECRET)).toBe(false)
    expect(fallback.verifyHmacSignature(payload, 'not-a-signature', SECRET)).toBe(false)
    expect(
      fallback.verifyHmacSignature(undefined as unknown as Buffer, good, SECRET)
    ).toBe(false)
  })
})

const nativeDescribe = native ? describe : describe.skip

nativeDescribe('webhook-verifier native/fallback parity', () => {
  it.each(vectors)('agrees on $name', ({ payload, bytes }) => {
    const signature = sign(SECRET, bytes)
    expect(native!(payload, signature, SECRET)).toBe(true)
    expect(native!(payload, signature, SECRET)).toBe(
      fallback.verifyHmacSignature(payload, signature, SECRET)
    )
  })

  it('agrees on rejection of a tampered signature', () => {
    const payload = Buffer.from('body')
    const tampered = sign(SECRET, Buffer.from('tampered'))

    expect(native!(payload, tampered, SECRET)).toBe(false)
    expect(native!(payload, tampered, SECRET)).toBe(
      fallback.verifyHmacSignature(payload, tampered, SECRET)
    )
  })

  it('agrees on the empty-secret fail-closed result', () => {
    const payload = Buffer.from('body')
    const signature = sign(SECRET, payload)

    expect(native!(payload, signature, '')).toBe(false)
    expect(native!(payload, signature, '')).toBe(
      fallback.verifyHmacSignature(payload, signature, '')
    )
  })
})
