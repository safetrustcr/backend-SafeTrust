'use strict';

const crypto = require('crypto');

/**
 * Verifies the `x-trustlesswork-signature` HMAC-SHA256 header TrustlessWork
 * sends on every escrow webhook callback, so a forged POST cannot inject
 * fraudulent escrow state (e.g. a fake `completed`/`funded` status with no
 * real Stellar transaction behind it).
 *
 * Requires `req.rawBody` (a `Buffer` of the exact request bytes) to be
 * populated by `express.json({ verify })` upstream — the HMAC is computed
 * over the raw bytes, not a re-serialized copy of the parsed body, since
 * re-serialization is not guaranteed to reproduce byte-for-byte what
 * TrustlessWork actually signed.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
module.exports = function verifyTrustlessWorkSignature(req, res, next) {
  const secret = process.env.TRUSTLESSWORK_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[trustlesswork-signature] TRUSTLESSWORK_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const signature = req.headers['x-trustlesswork-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing x-trustlesswork-signature header' });
  }

  const hmac = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

  const expected = Buffer.from(`sha256=${hmac}`);
  const received = Buffer.from(signature);

  try {
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  } catch {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
};
