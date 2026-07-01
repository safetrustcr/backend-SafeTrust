const db = require('../../services/db');

const meHandler = async (req, res) => {
  const uid = req.user.uid;   // set by auth.middleware.js
  const email = req.user.email;

  try {
    const result = await db.query(
      `SELECT r.name
       FROM public.user_roles ur
       JOIN public.roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [uid]
    );

    const roles = result.rows.map((row) => row.name);
    const isHost = roles.some((r) => ['host', 'admin'].includes(r));

    return res.status(200).json({
      user: {
        id: uid,
        email,
        roles,
      },
      redirect: isHost ? '/dashboard/escrow-dashboard' : '/dashboard/guest',
    });
  } catch (error) {
    console.error('[auth/me] ❌ error:', error.message);
    return res.status(500).json({ error: 'Failed to resolve user roles' });
  }
};

module.exports = { meHandler };
