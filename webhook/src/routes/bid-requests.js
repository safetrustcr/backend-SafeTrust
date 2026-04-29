const express = require('express');
const router = express.Router();
const db = require('../services/db');

/**
 * @route POST /api/bid-requests
 * @desc Create a new bid request for an apartment.
 * @access Protected
 */
router.post('/', async (req, res) => {
  const { apartment_id, proposed_price, desired_move_in } = req.body;
  const tenant_id = req.user.uid;

  if (!apartment_id || !proposed_price || !desired_move_in) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check for duplicate pending bid
    const checkQuery = `
      SELECT id FROM public.bid_requests 
      WHERE tenant_id = $1 AND apartment_id = $2 AND current_status = 'PENDING' AND deleted_at IS NULL
    `;
    const checkResult = await db.query(checkQuery, [tenant_id, apartment_id]);
    if (checkResult.rows.length > 0) {
      return res.status(409).json({ error: 'Duplicate pending bid' });
    }

    const query = `
      INSERT INTO public.bid_requests (apartment_id, tenant_id, proposed_price, desired_move_in, current_status)
      VALUES ($1, $2, $3, $4, 'PENDING')
      RETURNING *
    `;
    const result = await db.query(query, [apartment_id, tenant_id, proposed_price, desired_move_in]);
    res.status(201).json({ bid: result.rows[0] });
  } catch (error) {
    console.error('[bid-requests] ❌ error:', error.message);
    if (error.message.includes('Tenant already has an active bid')) {
       return res.status(409).json({ error: 'Tenant already has an active bid' });
    }
    res.status(500).json({ error: 'Database error' });
  }
});

/**
 * @route PATCH /api/bid-requests/:id
 * @desc Update bid status (Approve/Cancel).
 * @access Protected (Owner only for Approval)
 */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const user_id = req.user.uid;

  if (!['APPROVED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const bidQuery = `
      SELECT b.*, a.owner_id 
      FROM public.bid_requests b
      JOIN public.apartments a ON b.apartment_id = a.id
      WHERE b.id = $1 AND b.deleted_at IS NULL
    `;
    const bidResult = await db.query(bidQuery, [id]);

    if (bidResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bid not found' });
    }

    const bid = bidResult.rows[0];

    // Check ownership for approval
    if (status === 'APPROVED' && bid.owner_id !== user_id) {
      return res.status(403).json({ error: 'Only owner can approve' });
    }

    // Check status transition
    if (bid.current_status === 'CANCELLED' && status === 'APPROVED') {
      return res.status(400).json({ error: 'Invalid transition' });
    }

    const updateQuery = `
      UPDATE public.bid_requests 
      SET current_status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(updateQuery, [status, id]);
    res.status(200).json({ bid: result.rows[0] });
  } catch (error) {
    console.error('[bid-requests] ❌ error:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
