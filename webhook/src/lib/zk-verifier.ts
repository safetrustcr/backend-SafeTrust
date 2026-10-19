'use strict';

import { createHash, timingSafeEqual } from 'node:crypto';
import type * as NativeVerifier from '../../../crates/zk-verifier';

export type ZkVerifierError = Error & { code: 'ZK_VERIFIER_UNAVAILABLE' | 'ZK_VERIFIER_MISCONFIGURED' };

function createZkError(
  message: string,
  code: ZkVerifierError['code'],
  cause?: unknown
): ZkVerifierError {
  const error = new Error(message) as ZkVerifierError;
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

let nativeVerifier: typeof NativeVerifier | null = null;
let nativeLoadError: unknown = null;

try {
  nativeVerifier = require('../../../crates/zk-verifier');
} catch (error) {
  nativeLoadError = error;
  console.warn(
    '[zk-verifier] native addon unavailable; ZK proof verification will fail closed:',
    error instanceof Error ? error.message : error
  );
}

/**
 * Verify a proof-of-funds proof with the Rust UltraHonk addon.
 * The addon is optional for non-ZK requests, but ZK requests fail closed.
 */
export function verifyProofOfFunds(
  proofHex: string,
  verificationKeyHex: string,
  thresholdStroops: string,
  balanceCommitmentHex: string
) {
  if (!nativeVerifier) {
    throw createZkError(
      'ZK proof verifier is unavailable',
      'ZK_VERIFIER_UNAVAILABLE',
      nativeLoadError
    );
  }

  // A proof only establishes the statement encoded by its verification key.
  // Pin the SafeTrust circuit key in production so a valid proof for an
  // attacker-controlled circuit cannot be substituted. The pin is optional
  // to keep local circuit development frictionless.
  const expectedKeyHash = process.env.ZK_PROOF_OF_FUNDS_VK_SHA256;
  if (expectedKeyHash) {
    if (!/^[0-9a-fA-F]{64}$/.test(expectedKeyHash)) {
      throw createZkError(
        'ZK verification key hash is misconfigured',
        'ZK_VERIFIER_MISCONFIGURED'
      );
    }

    const normalizedKey = verificationKeyHex.replace(/^0x/, '');
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(normalizedKey)) return false;

    const actual = createHash('sha256')
      .update(Buffer.from(normalizedKey, 'hex'))
      .digest();
    const expected = Buffer.from(expectedKeyHash, 'hex');
    if (!timingSafeEqual(actual, expected)) return false;
  }

  return nativeVerifier.verifyProofOfFunds(
    proofHex,
    verificationKeyHex,
    thresholdStroops,
    balanceCommitmentHex
  );
}
