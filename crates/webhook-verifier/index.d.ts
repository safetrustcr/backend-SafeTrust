/**
 * Verify a TrustlessWork HMAC-SHA256 webhook signature over exact bytes.
 * Throws if `secret` is empty.
 */
export function verifyHmacSignature(
  payload: Buffer | Uint8Array,
  signature: string,
  secret: string
): boolean

/**
 * Validate a Stellar address using strkey encoding rules.
 * Returns true for valid G... public keys, false otherwise.
 */
export function validateStellarAddress(address: string): boolean
