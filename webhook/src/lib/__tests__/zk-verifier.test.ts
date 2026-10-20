'use strict';

import { createHash } from 'node:crypto';
import {
  verifyProofOfFunds,
  _setNativeVerifierForTesting,
  ZkVerifierError,
} from '../zk-verifier';

describe('zk-verifier library', () => {
  const originalEnv = process.env;
  const mockNativeVerifier = {
    verifyProofOfFunds: jest.fn(),
  };

  const sampleVkHex = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  const sampleVkSha256 = createHash('sha256')
    .update(Buffer.from(sampleVkHex, 'hex'))
    .digest('hex');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, ZK_ENABLED: 'true' };
    _setNativeVerifierForTesting(mockNativeVerifier as any);
  });

  afterAll(() => {
    process.env = originalEnv;
    _setNativeVerifierForTesting(null);
  });

  describe('ZK feature flag', () => {
    it('throws ZK_FEATURE_DISABLED when ZK_ENABLED is not true', () => {
      delete process.env.ZK_ENABLED;
      expect(() => {
        verifyProofOfFunds('00', sampleVkHex, '1000', '00'.repeat(32));
      }).toThrow(
        expect.objectContaining({
          code: 'ZK_FEATURE_DISABLED',
          message: 'ZK proof verification is disabled',
        })
      );
    });
  });

  describe('native verifier availability', () => {
    it('throws ZK_VERIFIER_UNAVAILABLE when native verifier is missing', () => {
      _setNativeVerifierForTesting(null);

      expect(() => {
        verifyProofOfFunds('00', sampleVkHex, '1000', '00'.repeat(32));
      }).toThrow(
        expect.objectContaining({
          code: 'ZK_VERIFIER_UNAVAILABLE',
          message: 'ZK proof verifier is unavailable',
        })
      );
    });
  });

  describe('production verification key pinning (ADR-0001)', () => {
    it('throws ZK_VERIFIER_MISCONFIGURED in production if VK hash is unset', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ZK_PROOF_OF_FUNDS_VK_SHA256;

      expect(() => {
        verifyProofOfFunds('00', sampleVkHex, '1000', '00'.repeat(32));
      }).toThrow(
        expect.objectContaining({
          code: 'ZK_VERIFIER_MISCONFIGURED',
          message: expect.stringContaining('mandatory in production'),
        })
      );
      expect(mockNativeVerifier.verifyProofOfFunds).not.toHaveBeenCalled();
    });

    it('throws ZK_VERIFIER_MISCONFIGURED when NODE_ENV is unset and VK hash is missing (fail-closed default)', () => {
      delete process.env.NODE_ENV;
      delete process.env.ZK_PROOF_OF_FUNDS_VK_SHA256;

      expect(() => {
        verifyProofOfFunds('00', sampleVkHex, '1000', '00'.repeat(32));
      }).toThrow(
        expect.objectContaining({
          code: 'ZK_VERIFIER_MISCONFIGURED',
        })
      );
      expect(mockNativeVerifier.verifyProofOfFunds).not.toHaveBeenCalled();
    });

    it('throws ZK_VERIFIER_MISCONFIGURED in staging environment if VK hash is unset', () => {
      process.env.NODE_ENV = 'staging';
      delete process.env.ZK_PROOF_OF_FUNDS_VK_SHA256;

      expect(() => {
        verifyProofOfFunds('00', sampleVkHex, '1000', '00'.repeat(32));
      }).toThrow(
        expect.objectContaining({
          code: 'ZK_VERIFIER_MISCONFIGURED',
        })
      );
      expect(mockNativeVerifier.verifyProofOfFunds).not.toHaveBeenCalled();
    });

    it('throws ZK_VERIFIER_MISCONFIGURED in production if VK hash is empty string', () => {
      process.env.NODE_ENV = 'production';
      process.env.ZK_PROOF_OF_FUNDS_VK_SHA256 = '';

      expect(() => {
        verifyProofOfFunds('00', sampleVkHex, '1000', '00'.repeat(32));
      }).toThrow(
        expect.objectContaining({
          code: 'ZK_VERIFIER_MISCONFIGURED',
        })
      );
    });

    it('throws ZK_VERIFIER_MISCONFIGURED if VK hash format is invalid (not 64-char hex)', () => {
      process.env.NODE_ENV = 'production';
      process.env.ZK_PROOF_OF_FUNDS_VK_SHA256 = 'not-a-valid-sha256';

      expect(() => {
        verifyProofOfFunds('00', sampleVkHex, '1000', '00'.repeat(32));
      }).toThrow(
        expect.objectContaining({
          code: 'ZK_VERIFIER_MISCONFIGURED',
          message: 'ZK verification key hash is misconfigured',
        })
      );
    });

    it('rejects with false when VK does not match pinned hash (circuit substitution defense)', () => {
      process.env.NODE_ENV = 'production';
      process.env.ZK_PROOF_OF_FUNDS_VK_SHA256 = sampleVkSha256;

      const attackerVkHex = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      const result = verifyProofOfFunds('00', attackerVkHex, '1000', '00'.repeat(32));

      expect(result).toBe(false);
      expect(mockNativeVerifier.verifyProofOfFunds).not.toHaveBeenCalled();
    });

    it('rejects with false when VK has invalid non-hex characters', () => {
      process.env.NODE_ENV = 'production';
      process.env.ZK_PROOF_OF_FUNDS_VK_SHA256 = sampleVkSha256;

      const invalidHexVk = 'not-hex-characters!';
      const result = verifyProofOfFunds('00', invalidHexVk, '1000', '00'.repeat(32));

      expect(result).toBe(false);
      expect(mockNativeVerifier.verifyProofOfFunds).not.toHaveBeenCalled();
    });

    it('delegates to native verifier when VK matches pinned hash in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.ZK_PROOF_OF_FUNDS_VK_SHA256 = sampleVkSha256;
      mockNativeVerifier.verifyProofOfFunds.mockReturnValue(true);

      const result = verifyProofOfFunds('00', `0x${sampleVkHex}`, '1000', '00'.repeat(32));

      expect(result).toBe(true);
      expect(mockNativeVerifier.verifyProofOfFunds).toHaveBeenCalledWith(
        '00',
        `0x${sampleVkHex}`,
        '1000',
        '00'.repeat(32)
      );
    });
  });

  describe('non-production environment', () => {
    it('allows verification without pin in development/test environment', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.ZK_PROOF_OF_FUNDS_VK_SHA256;
      mockNativeVerifier.verifyProofOfFunds.mockReturnValue(true);

      const result = verifyProofOfFunds('00', sampleVkHex, '1000', '00'.repeat(32));

      expect(result).toBe(true);
      expect(mockNativeVerifier.verifyProofOfFunds).toHaveBeenCalled();
    });

    it('enforces pin check if pin is optionally configured in development/test', () => {
      process.env.NODE_ENV = 'development';
      process.env.ZK_PROOF_OF_FUNDS_VK_SHA256 = sampleVkSha256;

      const mismatchedVk = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const result = verifyProofOfFunds('00', mismatchedVk, '1000', '00'.repeat(32));

      expect(result).toBe(false);
      expect(mockNativeVerifier.verifyProofOfFunds).not.toHaveBeenCalled();
    });
  });
});
