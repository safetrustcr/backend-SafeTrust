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

let nativeVerifier: typeof NativeVerifier | null | undefined = undefined;

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

  let verifier = nativeVerifier;

  if (verifier === undefined) {
    try {
      // Do not load the experimental native addon during normal application startup.
      verifier = require('../../../crates/zk-verifier');
    } catch (cause) {
      throw createZkError(
        'ZK proof verifier is unavailable',
        'ZK_VERIFIER_UNAVAILABLE',
        cause
      );
    }
  }

  if (!verifier) {
    throw createZkError(
      'ZK proof verifier is unavailable',
      'ZK_VERIFIER_UNAVAILABLE'
    );
  }

  // A proof only establishes the statement encoded by its verification key.
  // Pin the SafeTrust circuit key so a valid proof for an attacker-controlled
  // circuit cannot be substituted. By default, this pin is mandatory in all
  // environments (including production, staging, or unset NODE_ENV) to fail closed;
  // it is exempt only when NODE_ENV is explicitly 'development' or 'test' to keep
  // local circuit development frictionless.
  const isDevOrTest =
    process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  const expectedKeyHash = process.env.ZK_PROOF_OF_FUNDS_VK_SHA256;

  if (!isDevOrTest && !expectedKeyHash) {
    const error = new Error(
      'ZK verification key hash pin (ZK_PROOF_OF_FUNDS_VK_SHA256) is mandatory in production and non-development environments'
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

  return verifier.verifyProofOfFunds(
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


