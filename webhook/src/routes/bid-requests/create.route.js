const express = require('express');
const router = express.Router();
const { createBidRequestHandler } = require('./create.handler');

function validateCreateBidRequest(req, res, next) {
  const { apartmentId, proposedPrice, desiredMoveIn } = req.body || {};
  if (apartmentId == null || proposedPrice == null || desiredMoveIn == null) {
    return res.status(400).json({ error: 'Missing required fields: apartmentId, proposedPrice, desiredMoveIn' });
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
