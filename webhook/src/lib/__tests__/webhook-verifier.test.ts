import crypto from 'crypto'

const {
  verifyHmacSignature,
  validateStellarAddress,
} = require('../../../../crates/webhook-verifier') as {
  verifyHmacSignature: (
    payload: Buffer | Uint8Array,
    signature: string,
    secret: string
  ) => boolean
  validateStellarAddress: (address: string) => boolean
}

const SECRET = 'dev-secret'
const PAYLOAD = Buffer.from(JSON.stringify({ contractId: 'escrow-1', status: 'funded' }))

function sign(secret: string, payload: Buffer): string {
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `sha256=${hmac}`
}

describe('webhook-verifier native addon', () => {
  it('verifyHmacSignature returns true for a matching signature', () => {
    expect(verifyHmacSignature(PAYLOAD, sign(SECRET, PAYLOAD), SECRET)).toBe(true)
  })

  it('verifyHmacSignature returns false for mismatched signatures', () => {
    expect(verifyHmacSignature(PAYLOAD, sign('other-secret', PAYLOAD), SECRET)).toBe(false)
    expect(verifyHmacSignature(PAYLOAD, sign(SECRET, Buffer.from('tampered')), SECRET)).toBe(
      false
    )
    expect(verifyHmacSignature(PAYLOAD, 'not-a-valid-signature', SECRET)).toBe(false)
  })

  it('verifyHmacSignature throws on an empty secret', () => {
    expect(() => verifyHmacSignature(PAYLOAD, sign(SECRET, PAYLOAD), '')).toThrow(
      /HMAC secret must not be empty/
    )
  })

  it('verifyHmacSignature hashes invalid UTF-8 payload bytes', () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0x00, 0x80])
    expect(verifyHmacSignature(invalidUtf8, sign(SECRET, invalidUtf8), SECRET)).toBe(true)
  })

  it('validateStellarAddress returns true for valid G... addresses', () => {
    expect(
      validateStellarAddress('GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H')
    ).toBe(true)
  })

  it('validateStellarAddress returns false otherwise', () => {
    expect(validateStellarAddress('')).toBe(false)
    expect(validateStellarAddress('not-an-address')).toBe(false)
    expect(validateStellarAddress('GSHORT')).toBe(false)
    expect(
      validateStellarAddress('GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z')
    ).toBe(false)
    expect(
      validateStellarAddress('gbrpyhil2ci3fnq4bxlfmndlfjunpu2hy3zmfshonuceoasw7qc7ox2h')
    ).toBe(false)
  })
})
