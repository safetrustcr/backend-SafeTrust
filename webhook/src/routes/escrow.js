const express = require('express');
const router = express.Router();
const { pool } = require('../services/db');

/**
 * POST /webhooks/escrow_status_update
 *
 * Receives TrustlessWork escrow status change events and updates
 * the trustless_work_escrows table. Always returns 200 to prevent
 * TrustlessWork from retrying indefinitely.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
router.post('/escrow_status_update', async (req, res) => {
  const { event } = req.body;
  const newData = event?.data?.new;

  if (!newData?.contract_id) {
    console.warn('[escrow_status_update] Missing contract_id in payload');
    return res.status(200).json({ message: 'Ignored — missing contract_id' });
  }

  const { contract_id, status, amount, balance } = newData;

  try {
    const result = await pool.query(
      `UPDATE public.trustless_work_escrows
         SET status     = $1,
             amount     = $2,
             balance    = $3,
             updated_at = NOW()
       WHERE contract_id = $4
       RETURNING contract_id`,
      [status, amount, balance, contract_id]
    );

    if (result.rows.length === 0) {
      console.warn(`[escrow_status_update] contract_id=${contract_id} not found`);
    } else {
      console.log(`[escrow_status_update] contract_id=${contract_id} → ${status}`);
    }

    return res.status(200).json({ message: 'Escrow status updated' });
  } catch (error) {
    console.error('[escrow_status_update]', error.message);
    return res.status(200).json({ message: 'Webhook received, DB update failed' });
  }
});

module.exports = router;
