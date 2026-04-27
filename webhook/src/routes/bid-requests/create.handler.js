const db = require('../../services/db');

const EXISTING_PENDING = `
  SELECT id FROM public.bid_requests
  WHERE apartment_id = $1
    AND tenant_id = $2
    AND current_status = 'PENDING'
    AND deleted_at IS NULL
  LIMIT 1
`;

const INSERT_BID = `
  INSERT INTO public.bid_requests
    (apartment_id, tenant_id, proposed_price, desired_move_in, current_status)
  VALUES ($1, $2, $3, $4, 'PENDING')
  RETURNING *
`;

const INSERT_HISTORY = `
  INSERT INTO public.bid_status_histories
    (bid_request_id, status, changed_by)
  VALUES ($1, 'PENDING', $2)
`;

async function createBidRequestHandler(req, res) {
  const { uid } = req.user;
  const { apartmentId, proposedPrice, desiredMoveIn } = req.body;

  if (!apartmentId || !proposedPrice || !desiredMoveIn) {
    return res.status(400).json({
      error: 'Missing required fields: apartmentId, proposedPrice, desiredMoveIn',
    });
  }

  try {
    const existing = await db.query(EXISTING_PENDING, [apartmentId, uid]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'You already have a pending offer for this apartment',
      });
    }

    const result = await db.query(INSERT_BID, [apartmentId, uid, proposedPrice, desiredMoveIn]);
    const bid = result.rows[0];

    await db.query(INSERT_HISTORY, [bid.id, uid]);

    console.log(`[bid-requests/create] bid created — id: ${bid.id}`);
    return res.status(201).json({ bidRequest: bid });
  } catch (error) {
    console.error('[bid-requests/create]', error.message);
    return res.status(500).json({ error: 'Failed to create bid request' });
  }
}

module.exports = { createBidRequestHandler };
