const express = require('express');
const router = express.Router();
const { createBidRequestHandler } = require('./create.handler');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateCreateBidRequest(req, res, next) {
  const { apartmentId, proposedPrice, desiredMoveIn } = req.body || {};
  if (apartmentId == null || proposedPrice == null || desiredMoveIn == null) {
    return res.status(400).json({ error: 'Missing required fields: apartmentId, proposedPrice, desiredMoveIn' });
  }
  if (typeof apartmentId !== 'string' || !UUID_RE.test(apartmentId)) {
    return res.status(400).json({ error: 'apartmentId must be a valid UUID' });
  }
  if (typeof proposedPrice !== 'number' && typeof proposedPrice !== 'string') {
    return res.status(400).json({ error: 'proposedPrice must be a positive number' });
  }
  const price = Number(proposedPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'proposedPrice must be a positive number' });
  }
  if (isNaN(new Date(desiredMoveIn).getTime())) {
    return res.status(400).json({ error: 'desiredMoveIn must be a valid date' });
  }
  next();
}

router.post('/', validateCreateBidRequest, createBidRequestHandler);

module.exports = router;
