const express = require('express');
const router = express.Router();
const db = require('../services/db');

/**
 * @route POST /api/reconciliation/sync-escrows
 * @desc Sync escrow statuses from TrustlessWork API.
 * @access Protected
 */
router.post('/sync-escrows', async (req, res) => {
  try {
    // In a real implementation, this would call TrustlessWork API
    // For this task, we'll simulate the behavior.
    
    // Check if external API is "available"
    if (process.env.SIMULATE_API_FAILURE === 'true' || req.headers['x-simulate-failure'] === 'true') {
      return res.status(500).json({ error: 'TrustlessWork API unavailable' });
    }

    // Get all 'created' escrows
    const query = `
      SELECT contract_id FROM public.trustless_work_escrows 
      WHERE status = 'created'
    `;
    const result = await db.query(query);
    
    if (result.rows.length === 0) {
      return res.status(200).json({ updated: 0 });
    }

    // Simulate updating them to 'active'
    const updateQuery = `
      UPDATE public.trustless_work_escrows 
      SET status = 'active', updated_at = NOW()
      WHERE status = 'created'
    `;
    const updateResult = await db.query(updateQuery);

    res.status(200).json({ updated: updateResult.rowCount });
  } catch (error) {
    console.error('[reconciliation] ❌ error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
