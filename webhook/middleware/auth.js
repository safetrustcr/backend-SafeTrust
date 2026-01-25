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

module.exports = { authMiddleware };