const express = require('express');
const router = express.Router();
const db = require('../services/db');

/**
 * POST /api/auth/sync-user — upsert Firebase user into public.users.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/sync-user', async (req, res) => {
  const { uid, email } = req.user;

  try {
    const query = `
      INSERT INTO public.users (id, firebase_uid, email, last_seen)
      VALUES ($1, $1, $2, NOW())
      ON CONFLICT (firebase_uid)
      DO UPDATE SET last_seen = NOW(), email = EXCLUDED.email
      RETURNING id, firebase_uid, email, last_seen
    `;
    const values = [uid, email];

    const result = await db.query(query, values);
    const user = result.rows[0];

    console.log(`[sync-user] ✅ user synced — uid: ${user.firebase_uid}`);

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        last_seen: user.last_seen
      }
    });
  } catch (error) {
    console.error('[sync-user] ❌ error:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
