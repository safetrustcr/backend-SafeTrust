'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyHmacSignature = verifyHmacSignature;
exports.validateStellarAddress = validateStellarAddress;
const crypto = require("node:crypto");
/**
 * Normalize a payload to the exact bytes that are hashed.
 *
 * Strings are UTF-8 encoded once. `Buffer` and `Uint8Array` are used as raw
 * bytes, so invalid UTF-8 never gets re-encoded on the way to the digest. This
 * is the same representation the Rust side uses (`JsBuffer` bytes, or a
 * `JsString` encoded as UTF-8).
 */
function payloadBytes(payload) {
    if (Buffer.isBuffer(payload))
        return payload;
    if (payload instanceof Uint8Array) {
        return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    }
    if (typeof payload === 'string')
        return Buffer.from(payload, 'utf8');
    return null;
}
/**
 * Verify a TrustlessWork HMAC-SHA256 webhook signature.
 *
 * Fail-closed by contract: a missing/empty secret, a malformed signature, an
 * unsupported payload type, or any comparison error returns `false`. It never
 * throws and never returns `true` on an error path.
 */
function verifyHmacSignature(payload, signature, secret) {
    try {
        if (typeof secret !== 'string' || secret.length === 0)
            return false;
        if (typeof signature !== 'string' || signature.length === 0)
            return false;
        const bytes = payloadBytes(payload);
        if (!bytes)
            return false;
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(bytes);
        const expected = `sha256=${hmac.digest('hex')}`;
        // Compare the encoded bytes, not JS string code units. A length check
        // keeps timingSafeEqual from throwing on mismatched buffers.
        const expectedBytes = Buffer.from(expected, 'utf8');
        const receivedBytes = Buffer.from(signature, 'utf8');
        if (receivedBytes.length !== expectedBytes.length)
            return false;
        return crypto.timingSafeEqual(receivedBytes, expectedBytes);
    }
    catch {
        return false;
    }
}
function crc16Xmodem(data) {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i] << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xffff;
            }
            else {
                crc = (crc << 1) & 0xffff;
            }
        }
    }
    return crc;
}
/** Validate a Stellar `G…` strkey using base32 + CRC16-XModem. */
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
        if (val === -1)
            return false;
        bits = (bits << 5) | val;
        bitCount += 5;
        if (bitCount >= 8) {
            bitCount -= 8;
            if (idx >= 35)
                return false;
            out[idx++] = (bits >> bitCount) & 0xff;
        }
    }
    if (idx !== 35)
        return false;
    if (out[0] !== 0x30)
        return false; // ed25519 public key version byte
    const checksum = crc16Xmodem(out.subarray(0, 33));
    const expectedChecksum = out[33] | (out[34] << 8);
    return checksum === expectedChecksum;
}
