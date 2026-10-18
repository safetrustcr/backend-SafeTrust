/**
 * Verify a TrustlessWork HMAC-SHA256 webhook signature over exact bytes.
 *
 * Accepts a Buffer/TypedArray (raw request bytes) or a string (UTF-8 encoded
 * once). Returns `false` for an empty secret, a malformed signature, an
 * unsupported payload, or any comparison error. Never throws.
 */
export function verifyHmacSignature(
  payload: Buffer | Uint8Array | string,
  signature: string,
  secret: string
): boolean

/**
 * Validate a Stellar address using strkey encoding rules.
 * Returns true for valid G... public keys, false otherwise.
 */
export function validateStellarAddress(address: string): boolean
