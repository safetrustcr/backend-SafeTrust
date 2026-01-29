/**
 * IP Whitelist Middleware
 * Restricts access to whitelisted IP addresses
 */

/**
 * Get client IP address from request
 * Handles proxies and load balancers
 */
const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip
  );
};

/**
 * Check if IP is in CIDR range
 */
const isIpInCidr = (ip, cidr) => {
  const [range, bits = 32] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1);

  const ipParts = ip.split('.').map(Number);
  const rangeParts = range.split('.').map(Number);

  const ipNum = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
  const rangeNum = (rangeParts[0] << 24) + (rangeParts[1] << 16) + (rangeParts[2] << 8) + rangeParts[3];

  return (ipNum & mask) === (rangeNum & mask);
};

/**
 * IP Whitelist Middleware
 */
const ipWhitelist = (req, res, next) => {
  // Skip IP check if not enabled
  if (process.env.IP_WHITELIST_ENABLED !== 'true') {
    return next();
  }

  // Skip for health checks
  if (req.path === '/health') {
    return next();
  }

  const clientIp = getClientIp(req);
  const whitelistedIps = process.env.IP_WHITELIST?.split(',').map((ip) => ip.trim()) || [];

  // Allow localhost/internal IPs by default in development
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const localIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];

  if (isDevelopment && localIps.includes(clientIp)) {
    return next();
  }

  // If no whitelist is configured, allow all (log warning)
  if (whitelistedIps.length === 0) {
    console.warn('IP_WHITELIST is empty but IP_WHITELIST_ENABLED is true');
    return next();
  }

  // Check if IP is whitelisted
  const isWhitelisted = whitelistedIps.some((whitelistedIp) => {
    // Exact match
    if (whitelistedIp === clientIp) {
      return true;
    }

    // CIDR range match
    if (whitelistedIp.includes('/')) {
      try {
        return isIpInCidr(clientIp, whitelistedIp);
      } catch (error) {
        console.error(`Invalid CIDR range: ${whitelistedIp}`, error);
        return false;
      }
    }

    return false;
  });

  if (!isWhitelisted) {
    console.warn(`Blocked request from non-whitelisted IP: ${clientIp}`);
    return res.status(403).json({ error: 'Access forbidden' });
  }

  next();
};

module.exports = ipWhitelist;
