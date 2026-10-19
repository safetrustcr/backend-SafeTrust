'use strict';

import { createHash, timingSafeEqual } from 'node:crypto';
import type * as NativeVerifier from '../../../crates/zk-verifier';

export type ZkVerifierError = Error & {
  code: 'ZK_FEATURE_DISABLED' | 'ZK_VERIFIER_UNAVAILABLE' | 'ZK_VERIFIER_MISCONFIGURED';
};

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

/**
 * Verify a proof-of-funds proof with the Rust UltraHonk addon.
 * ZK is opt-in and the native addon is loaded only when explicitly enabled.
 */
export function verifyProofOfFunds(
  proofHex: string,
  verificationKeyHex: string,
  thresholdStroops: string,
  balanceCommitmentHex: string
) {
  if (process.env.ZK_ENABLED !== 'true') {
    throw createZkError(
      'ZK proof verification is disabled',
      'ZK_FEATURE_DISABLED'
    );
  }

  let nativeVerifier: typeof NativeVerifier;

  try {
    // Do not load the experimental native addon during normal application startup.
    nativeVerifier = require('../../../crates/zk-verifier');
  } catch (cause) {
    throw createZkError(
      'ZK proof verifier is unavailable',
      'ZK_VERIFIER_UNAVAILABLE',
      cause
    );
  }

  // A proof only establishes the statement encoded by its verification key.
  // Pin the SafeTrust circuit key in production so a valid proof for an
  // attacker-controlled circuit cannot be substituted. In production, this
  // pin is mandatory. In non-production, the pin is optional to keep local
  // circuit development frictionless.
  const isProduction = process.env.NODE_ENV === 'production';
  const expectedKeyHash = process.env.ZK_PROOF_OF_FUNDS_VK_SHA256;

  if (isProduction && !expectedKeyHash) {
    const error = new Error(
      'ZK verification key hash pin (ZK_PROOF_OF_FUNDS_VK_SHA256) is mandatory in production'
    ) as ZkVerifierError;
    error.code = 'ZK_VERIFIER_MISCONFIGURED';
    throw error;
  }

  if (expectedKeyHash) {
    if (!/^[0-9a-fA-F]{64}$/.test(expectedKeyHash)) {
      const error = new Error('ZK verification key hash is misconfigured') as ZkVerifierError;
      error.code = 'ZK_VERIFIER_MISCONFIGURED';
      throw error;
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

/**
 * Test-only utility to mock or reset the native verifier.
 */
export function _setNativeVerifierForTesting(verifier: typeof NativeVerifier | null): void {
  nativeVerifier = verifier;
}


