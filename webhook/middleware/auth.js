/**
 * Admin Secret Verification Middleware
 * Verifies that requests come from a trusted source (Hasura)
 */

const verifyAdminSecret = (req, res, next) => {
  const adminSecret = req.headers['x-hasura-admin-secret'];
  const expectedSecret = process.env.HASURA_ADMIN_SECRET;

  if (!expectedSecret) {
    console.error('HASURA_ADMIN_SECRET is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!adminSecret) {
    return res.status(401).json({ error: 'Missing admin secret' });
  }

  if (adminSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid admin secret' });
  }

  next();
};

module.exports = { verifyAdminSecret };
