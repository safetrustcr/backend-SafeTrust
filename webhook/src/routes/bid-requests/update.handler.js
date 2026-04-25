const { pool } = require('../../services/db')

const VALID_TRANSITIONS = {
  PENDING: ['APPROVED', 'CANCELLED'],
  APPROVED: ['CONFIRMED', 'CANCELLED'],
}

async function updateBidRequestHandler(req, res) {
  const { uid } = req.user || {}
  const { id } = req.params
  const { status: newStatus } = req.body || {}

  if (!newStatus) {
    return res.status(400).json({ error: 'Missing required field: status' })
  }

  const GET_BID = `
    SELECT br.*, a.owner_id
    FROM public.bid_requests br
    JOIN public.apartments a ON br.apartment_id = a.id
    WHERE br.id = $1 AND br.deleted_at IS NULL
  `

  const UPDATE_BID = `
    UPDATE public.bid_requests
    SET current_status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `

  const INSERT_HISTORY = `
    INSERT INTO public.bid_status_histories
      (bid_request_id, status, changed_by)
    VALUES ($1, $2, $3)
  `

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const result = await client.query(GET_BID, [id])
    if (result.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Bid request not found' })
    }

    const bid = result.rows[0]

    if (bid.owner_id !== uid) {
      await client.query('ROLLBACK')
      return res.status(403).json({
        error: 'Forbidden — only the apartment owner can update this bid',
      })
    }

    const allowed = VALID_TRANSITIONS[bid.current_status] ?? []
    if (!allowed.includes(newStatus)) {
      await client.query('ROLLBACK')
      return res.status(400).json({
        error: `Cannot transition from ${bid.current_status} to ${newStatus}`,
        allowedTransitions: allowed,
      })
    }

    const updated = await client.query(UPDATE_BID, [newStatus, id])
    await client.query(INSERT_HISTORY, [id, newStatus, uid])

    await client.query('COMMIT')

    console.log(`[bid-requests/update] ✅ ${id} → ${newStatus}`)
    return res.status(200).json({ bidRequest: updated.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[bid-requests/update] ❌', error.message)
    return res.status(500).json({ error: 'Failed to update bid request' })
  } finally {
    client.release()
  }
}

module.exports = { updateBidRequestHandler, VALID_TRANSITIONS }

