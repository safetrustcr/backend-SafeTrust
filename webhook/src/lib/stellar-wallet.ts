'use strict'

/**
 * @file webhook/src/lib/stellar-wallet.ts
 * @description Stellar account-address validation and the Ed25519 check for
 * the wallet ownership challenge, on `@stellar/stellar-sdk`.
 *
 * Ported from the former Rust `crates/stellar-utils` addon; its test vectors
 * live on in `lib/__tests__/stellar-wallet.test.ts`. Neither function throws:
 * malformed input of any kind returns `false`.
 */

import { Keypair, StrKey } from '@stellar/stellar-sdk'

const SIGNATURE_HEX = /^[0-9a-fA-F]{128}$/

/**
 * Whether `address` is a Stellar account address: a `G…` strkey whose version
 * byte and CRC16 checksum both check out. Contract (`C…`), muxed (`M…`),
 * secret-seed and other strkey types are rejected.
 */
export function isStellarAccountAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false
  try {
    return StrKey.isValidEd25519PublicKey(address)
  } catch {
    return false
  }
}

/**
 * Verify an Ed25519 signature over `message` against a Stellar account.
 *
 * - `message`      — the exact text that was signed, hashed as its UTF-8 bytes.
 * - `signatureHex` — the 64-byte signature, hex-encoded (128 characters).
 * - `address`      — the signer's `G…` account address.
 *
 * `Keypair.verify` runs RFC 8032 verification in strict mode: it rejects
 * non-canonical encodings, `S >= L` and small-order public keys.
 */
export function verifyStellarEd25519(
  message: unknown,
  signatureHex: unknown,
  address: unknown
): boolean {
  if (typeof message !== 'string') return false
  if (typeof signatureHex !== 'string' || !SIGNATURE_HEX.test(signatureHex)) return false
  if (!isStellarAccountAddress(address)) return false
  try {
    const data = new Uint8Array(Buffer.from(message, 'utf8'))
    const signature = new Uint8Array(Buffer.from(signatureHex, 'hex'))
    return Keypair.fromPublicKey(address).verify(data, signature)
  } catch {
    return false
  }
}
