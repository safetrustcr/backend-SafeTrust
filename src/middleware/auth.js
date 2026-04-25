const jwt = require('jsonwebtoken');

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Misconfiguration: treat as server error (not auth failure).
    return res.status(500).json({ error: 'Auth not configured' });
  }

  try {
    req.user = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return next();
  } catch (_err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { requireAuth };
