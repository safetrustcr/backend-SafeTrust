interface NativeBindings {
  verifyHmacSignature(
    payload: Buffer | Uint8Array | string,
    signature: string,
    secret: string
  ): boolean
  validateStellarAddress(address: string): boolean
}

import * as fallback from './fallback'

let bindings: NativeBindings
'use strict'

try {
  bindings = require('./index.node') as NativeBindings
} catch (err) {
  // The fallback hashes the same raw bytes as the native addon and returns
  // false on every error path. Keeping it in one module lets the parity test
  // exercise both implementations with identical vectors.
  bindings = fallback
}

export = bindings
