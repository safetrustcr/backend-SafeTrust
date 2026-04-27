const db = require('../../services/db');

// Mirrors the check_active_bids trigger: one active bid per tenant across all apartments
const EXISTING_ACTIVE = `
  SELECT id FROM public.bid_requests
  WHERE tenant_id = $1
    AND current_status IN ('PENDING', 'VIEWED', 'APPROVED')
    AND deleted_at IS NULL
  LIMIT 1
`;

const INSERT_BID = `
  INSERT INTO public.bid_requests
    (apartment_id, tenant_id, proposed_price, desired_move_in, current_status)
  VALUES ($1, $2, $3, $4, 'PENDING')
  RETURNING *
`;

async function createBidRequestHandler(req, res) {
  const { uid } = req.user;
  const { apartmentId, proposedPrice, desiredMoveIn } = req.body;

  if (apartmentId == null || proposedPrice == null || desiredMoveIn == null) {
    return res.status(400).json({
      error: 'Missing required fields: apartmentId, proposedPrice, desiredMoveIn',
    });
  }

  const price = Number(proposedPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'proposedPrice must be a positive number' });
  }

  const moveIn = new Date(desiredMoveIn);
  if (isNaN(moveIn.getTime())) {
    return res.status(400).json({ error: 'desiredMoveIn must be a valid date' });
  }

  try {
    const existing = await db.query(EXISTING_ACTIVE, [uid]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'You already have an active offer. Cancel it before submitting a new one.',
      });
    }

    const result = await db.query(INSERT_BID, [apartmentId, uid, price, moveIn.toISOString()]);
    const bid = result.rows[0];

    // bid_status_histories entry is inserted automatically by the record_bid_status trigger

    console.log(`[bid-requests/create] bid created — id: ${bid.id}`);
    return res.status(201).json({ bidRequest: bid });
  } catch (error) {
    // The check_active_bids trigger raises this on concurrent duplicate inserts
    if (error.message && error.message.includes('Tenant already has an active bid')) {
      return res.status(409).json({
        error: 'You already have an active offer. Cancel it before submitting a new one.',
      });
    }
    console.error('[bid-requests/create]', error.message);
    return res.status(500).json({ error: 'Failed to create bid request' });
  }
}

module.exports = { createBidRequestHandler };
