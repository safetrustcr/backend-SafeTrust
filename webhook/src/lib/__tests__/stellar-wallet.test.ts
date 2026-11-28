/**
 * Stellar address validation and the wallet-challenge Ed25519 check on
 * `@stellar/stellar-sdk`.
 *
 * Ports the Rust `crates/stellar-utils` unit tests and the address vectors of
 * `crates/webhook-verifier`. Every signature below was produced by the Rust
 * crate (`ed25519-dalek`, seed `[7u8; 32]`) before it was deleted, and Rust's
 * `verify_strict` accepted each one; Ed25519 signing is deterministic, so the
 * SDK must also reproduce them byte for byte.
 */

import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { isStellarAccountAddress, verifyStellarEd25519 } from '../stellar-wallet'

/** Account of the Rust fixed seed `[7u8; 32]`; also the Karate sync-wallet fixture. */
const ADDRESS_7 = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'
/** Account of the Rust fixed seed `[9u8; 32]`. */
const ADDRESS_9 = 'GD6ROJBYLKQMOW3E7N4M2YBPUHMZD7PL65VRHRMO24BOVSBV5H3BQRSL'
/** Rust `Strkey::Contract(Contract([0u8; 32]))`. */
const CONTRACT_0 = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4'

/**
 * The wallet-challenge message, exactly as `challengeMessage` in
 * `routes/auth/wallet-challenge.handler.ts` serializes it.
 */
const CHALLENGE_MESSAGE = JSON.stringify({
  purpose: 'SafeTrust wallet ownership verification',
  uid: 'user-1',
  walletAddress: ADDRESS_7,
  tenant: 'safetrust',
  domain: 'safetrust.example',
  network: 'testnet',
  nonce: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  expiresAt: '2026-01-01T00:05:00.000Z',
})

/** Non-ASCII text, to pin the UTF-8 encoding of the signed bytes. */
const UNICODE_MESSAGE = JSON.stringify({
  purpose: 'SafeTrust wallet ownership verification',
  uid: 'usuário-ñ-🔐',
  walletAddress: ADDRESS_7,
})

const RUST_SIGNATURES: Array<{ name: string; message: string; signature: string }> = [
  {
    name: 'Hello, SafeTrust!',
    message: 'Hello, SafeTrust!',
    signature:
      '1eea5b08a29d119057e2b1ef77e0e9f95f0876664d0e42062788fdc1f5a9a682ca1a74fd425bd780f5058dd0f6f7a12362136505fb8f2ae8fecdd4306148560e',
  },
  {
    name: 'x',
    message: 'x',
    signature:
      '483fccdc8e5f6c98476b19bbd2a9a2ff198f089e44e3cd60180b922a33da4d3f871678315b1823d50044d64841506eb0ec97191f031291e4b422535369bbcc0c',
  },
  {
    name: 'original message',
    message: 'original message',
    signature:
      'c62f2f740e596ff59d811ba620bb0281eef37a547d5ac0bde8fbdaa8c316b06dbac48bd5ad560c25b1d0a59047fce435387c0b48c08437d27b08493b6402b30e',
  },
  {
    name: 'wallet-challenge message',
    message: CHALLENGE_MESSAGE,
    signature:
      'e8988f10271c875822e0df4dc6a86846e682378a8295558e3795bb35bfbb3ff29433c3ffcb5c17853208834f9500d8f7f917be1f128498be60342f7b861cfa0e',
  },
  {
    name: 'non-ASCII wallet-challenge message',
    message: UNICODE_MESSAGE,
    signature:
      'e6e6b38b1076309f777164761cbf188d992d39471b7a5ab5fb6cdb27afd56cd8434771291241cbd70731504067e673de541e69efb683348d408e75fc66e1fe00',
  },
]

const seed = (byte: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, byte))

describe('isStellarAccountAddress — Rust unit tests (stellar-utils)', () => {
  it('known_good_address_is_valid', () => {
    expect(isStellarAccountAddress(ADDRESS_7)).toBe(true)
    // The Karate fixture is the strkey of a fixed keypair, so it is real.
    expect(seed(7).publicKey()).toBe(ADDRESS_7)
    expect(seed(9).publicKey()).toBe(ADDRESS_9)
  })

  it('rejects_malformed_addresses', () => {
    expect(isStellarAccountAddress('')).toBe(false)
    expect(isStellarAccountAddress('not-a-stellar-address')).toBe(false)
    // 55 chars (one short).
    expect(isStellarAccountAddress('GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7')).toBe(false)
    // Lowercase is not valid base32.
    expect(isStellarAccountAddress('gDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z')).toBe(false)
    // Valid alphabet/length but wrong checksum.
    expect(isStellarAccountAddress('GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J70')).toBe(false)
    // The old fabricated fixture: right shape, bad SEP-23 checksum.
    expect(isStellarAccountAddress('GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z')).toBe(false)
  })

  it('rejects_contract_strkeys', () => {
    expect(CONTRACT_0.startsWith('C')).toBe(true)
    expect(StrKey.isValidContract(CONTRACT_0)).toBe(true)
    expect(isStellarAccountAddress(CONTRACT_0)).toBe(false)
  })

  it('rejects other strkey types and non-strings', () => {
    expect(isStellarAccountAddress(seed(7).secret())).toBe(false)
    expect(isStellarAccountAddress(StrKey.encodeMed25519PublicKey(Buffer.alloc(40)))).toBe(false)
    expect(isStellarAccountAddress(undefined)).toBe(false)
    expect(isStellarAccountAddress(null)).toBe(false)
    expect(isStellarAccountAddress(42)).toBe(false)
  })
})

describe('isStellarAccountAddress — webhook-verifier address vectors', () => {
  it('valid_stellar_g_address', () => {
    const zeroKey = StrKey.encodeEd25519PublicKey(Buffer.alloc(32))
    expect(zeroKey).toHaveLength(56)
    expect(isStellarAccountAddress(zeroKey)).toBe(true)
    expect(isStellarAccountAddress('GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H')).toBe(true)
  })

  it('invalid_stellar_addresses', () => {
    const valid = StrKey.encodeEd25519PublicKey(Buffer.alloc(32))
    expect(isStellarAccountAddress('not-an-address')).toBe(false)
    expect(isStellarAccountAddress('GSHORT')).toBe(false)
    expect(isStellarAccountAddress(`${valid}EXTRA`)).toBe(false)
    // 0, 1, 8 and 9 are outside the base32 alphabet.
    expect(isStellarAccountAddress(`${valid.slice(0, 8)}0${valid.slice(9)}`)).toBe(false)
    expect(isStellarAccountAddress(valid.toLowerCase())).toBe(false)
    expect(isStellarAccountAddress('gbrpyhil2ci3fnq4bxlfmndlfjunpu2hy3zmfshonuceoasw7qc7ox2h')).toBe(false)
  })
})

describe('verifyStellarEd25519 — parity with the Rust ed25519-dalek signatures', () => {
  it.each(RUST_SIGNATURES)('accepts the Rust signature over $name', ({ message, signature }) => {
    expect(verifyStellarEd25519(message, signature, ADDRESS_7)).toBe(true)
    expect(verifyStellarEd25519(message, signature.toUpperCase(), ADDRESS_7)).toBe(true)
  })

  it.each(RUST_SIGNATURES)('signs $name to the same bytes as Rust', ({ message, signature }) => {
    expect(Buffer.from(seed(7).sign(Buffer.from(message, 'utf8'))).toString('hex')).toBe(signature)
  })
})

describe('verifyStellarEd25519 — Rust unit tests (stellar-utils)', () => {
  const [hello, x, original] = RUST_SIGNATURES

  it('verifies_signature_over_message', () => {
    expect(verifyStellarEd25519(hello.message, hello.signature, ADDRESS_7)).toBe(true)
  })

  it('rejects_tampered_message', () => {
    expect(verifyStellarEd25519('tampered message', original.signature, ADDRESS_7)).toBe(false)
    expect(verifyStellarEd25519(`${CHALLENGE_MESSAGE} `, RUST_SIGNATURES[3].signature, ADDRESS_7)).toBe(false)
  })

  it('rejects_signature_from_another_key', () => {
    expect(verifyStellarEd25519(hello.message, hello.signature, ADDRESS_9)).toBe(false)
  })

  it('rejects_malformed_signature_inputs', () => {
    expect(verifyStellarEd25519('message', 'not-hex', ADDRESS_7)).toBe(false)
    expect(verifyStellarEd25519('message', 'abcd', ADDRESS_7)).toBe(false) // wrong length
    expect(verifyStellarEd25519('message', x.signature, 'not-a-valid-strkey')).toBe(false)
    // A contract strkey is not an account.
    expect(verifyStellarEd25519('message', x.signature, CONTRACT_0)).toBe(false)
  })
})

describe('verifyStellarEd25519 — strict verification and never-throws contract', () => {
  it('rejects a flipped signature bit and a non-hex character of the right length', () => {
    const { message, signature } = RUST_SIGNATURES[3]
    const flipped = `${signature.slice(0, 127)}${signature[127] === '0' ? '1' : '0'}`
    expect(verifyStellarEd25519(message, flipped, ADDRESS_7)).toBe(false)
    expect(verifyStellarEd25519(message, `${signature.slice(0, 127)}g`, ADDRESS_7)).toBe(false)
  })

  it('rejects a non-canonical S (S + L), as verify_strict did', () => {
    const { message, signature } = RUST_SIGNATURES[0]
    const L = 2n ** 252n + 27742317777372353535851937790883648493n
    const sBytes = Buffer.from(signature.slice(64), 'hex')
    const s = BigInt(`0x${Buffer.from(sBytes).reverse().toString('hex')}`)
    const sPlusL = Buffer.from((s + L).toString(16).padStart(64, '0'), 'hex').reverse()
    const malleated = `${signature.slice(0, 64)}${sPlusL.toString('hex')}`
    expect(verifyStellarEd25519(message, malleated, ADDRESS_7)).toBe(false)
  })

  it('rejects a small-order public key, whose identity signature passes permissive checks', () => {
    // y = 1 encodes the identity point. With R = identity and S = 0 the
    // cofactored equation holds for every message; strict mode (and Rust's
    // verify_strict) must reject the weak key instead.
    const identity = Buffer.alloc(32)
    identity[0] = 1
    const weakAddress = StrKey.encodeEd25519PublicKey(identity)
    expect(isStellarAccountAddress(weakAddress)).toBe(true)
    const signature = `${identity.toString('hex')}${'00'.repeat(32)}`
    expect(verifyStellarEd25519('any message', signature, weakAddress)).toBe(false)
  })

  it('returns false instead of throwing for non-string arguments', () => {
    const { message, signature } = RUST_SIGNATURES[0]
    expect(verifyStellarEd25519(undefined, signature, ADDRESS_7)).toBe(false)
    expect(verifyStellarEd25519(Buffer.from(message), signature, ADDRESS_7)).toBe(false)
    expect(verifyStellarEd25519(message, undefined, ADDRESS_7)).toBe(false)
    expect(verifyStellarEd25519(message, signature, undefined)).toBe(false)
  })
})
