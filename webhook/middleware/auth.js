const { logger } = require('../utils/logger');

const authMiddleware = (req, res, next) => {
  // Check for Hasura Admin Secret header
  const secret = req.headers['x-hasura-admin-secret'];
  
  if (!secret || secret !== process.env.HASURA_GRAPHQL_ADMIN_SECRET) {
    logger.warn('Unauthorized access attempt to webhook');
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Secret' });
  }
  
  next();
};

module.exports = { authMiddleware };/**
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
