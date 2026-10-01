'use strict';

const crypto = require('crypto');

try {
  module.exports = require('./index.node');
} catch (err) {
  function crc16Xmodem(data) {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i] << 8;
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }
    return crc;
  }

  function verifyHmacSignature(payload, signature, secret) {
    if (!secret || secret.length === 0) {
      throw new Error('HMAC secret must not be empty');
    }
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expected = 'sha256=' + hmac.digest('hex');
    if (typeof signature !== 'string' || signature.length !== expected.length) {
      return false;
    }
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return signature === expected;
    }
  }

  function validateStellarAddress(address) {
    if (typeof address !== 'string' || address.length !== 56 || !address.startsWith('G')) {
      return false;
    }
    const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let bitCount = 0;
    const out = new Uint8Array(35);
    let idx = 0;

    for (let i = 0; i < address.length; i++) {
      const val = base32Alphabet.indexOf(address[i]);
      if (val === -1) return false;
      bits = (bits << 5) | val;
      bitCount += 5;
      if (bitCount >= 8) {
        bitCount -= 8;
        if (idx >= 35) return false;
        out[idx++] = (bits >> bitCount) & 0xff;
      }
    }
    if (idx !== 35) return false;
    if (out[0] !== 0x30) return false; // ed25519 public key version byte
    const checksum = crc16Xmodem(out.subarray(0, 33));
    const expectedChecksum = out[33] | (out[34] << 8);
    return checksum === expectedChecksum;
  }

  module.exports = {
    verifyHmacSignature,
    validateStellarAddress,
  };
}
