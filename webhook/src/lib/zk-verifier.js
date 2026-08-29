'use strict';

const { createHash, timingSafeEqual } = require('crypto');

let nativeVerifier = null;
let nativeLoadError = null;

try {
  nativeVerifier = require('../../../crates/zk-verifier');
} catch (error) {
  nativeLoadError = error;
}

/**
 * Verify a proof-of-funds proof with the Rust UltraHonk addon.
 * The addon is optional for non-ZK requests, but ZK requests fail closed.
 */
function verifyProofOfFunds(
  proofHex,
  verificationKeyHex,
  thresholdStroops,
  balanceCommitmentHex
) {
  if (!nativeVerifier) {
    const error = new Error('ZK proof verifier is unavailable');
    error.code = 'ZK_VERIFIER_UNAVAILABLE';
    error.cause = nativeLoadError;
    throw error;
  }

  // A proof only establishes the statement encoded by its verification key.
  // Pin the SafeTrust circuit key in production so a valid proof for an
  // attacker-controlled circuit cannot be substituted. The pin is optional
  // to keep local circuit development frictionless.
  const expectedKeyHash = process.env.ZK_PROOF_OF_FUNDS_VK_SHA256;
  if (expectedKeyHash) {
    if (!/^[0-9a-fA-F]{64}$/.test(expectedKeyHash)) {
      const error = new Error('ZK verification key hash is misconfigured');
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

module.exports = { verifyProofOfFunds };
