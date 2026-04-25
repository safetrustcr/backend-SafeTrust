const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { authenticateFirebase } = require('../middleware/auth');

/**
 * @route POST /api/auth/sync-user
 * @desc Upsert user data from Firebase auth
 * @access Protected
 */
router.post('/sync-user', authenticateFirebase, async (req, res) => {
  const { uid, email } = req.user;

  try {
    const query = `
      INSERT INTO public.users (id, email, last_seen)
      VALUES ($1, $2, NOW())
      ON CONFLICT (id)
      DO UPDATE SET last_seen = NOW()
      RETURNING id, email, last_seen
    `;
    const values = [uid, email];

    const result = await db.query(query, values);
    const user = result.rows[0];

    console.log(`[sync-user] ✅ user synced — uid: ${user.id} email: ${user.email}`);

    res.status(200).json({ user });
  } catch (error) {
    console.error('[sync-user] ❌ error:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
