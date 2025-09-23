const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const router = express.Router();

// Rate limiting store (in production, use Redis)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per IP

// Request timeout configuration
const REQUEST_TIMEOUT = parseInt(process.env.WEBHOOK_TIMEOUT) || 30000;
const MAX_REQUEST_SIZE = parseInt(process.env.MAX_REQUEST_SIZE) || 1048576; // 1MB

// Test mode - bypass database operations
const TEST_MODE = process.env.NODE_ENV === 'development' && process.env.TEST_MODE === 'true';

// Initialize PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@postgres:5432/postgres',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Firebase webhook secret for signature validation
const FIREBASE_WEBHOOK_SECRET = process.env.FIREBASE_WEBHOOK_SECRET;

/**
 * Validates Firebase webhook signature
 * @param {string} signature - The signature from the webhook header
 * @param {string} payload - The raw request body
 * @returns {boolean} - Whether the signature is valid
 */
function validateWebhookSignature(signature, payload) {
  if (!FIREBASE_WEBHOOK_SECRET) {
    console.warn('FIREBASE_WEBHOOK_SECRET not configured, skipping signature validation');
    return true;
  }

  if (!signature) {
    console.error('No signature provided in webhook request');
    return false;
  }

  try {
    // Extract the signature from the header (format: "sha256=...")
    const expectedSignature = signature.replace('sha256=', '');
    
    // Create HMAC hash
    const hmac = crypto.createHmac('sha256', FIREBASE_WEBHOOK_SECRET);
    hmac.update(payload, 'utf8');
    const calculatedSignature = hmac.digest('hex');
    
    // Simple string comparison for now (timing-safe comparison requires same length)
    return expectedSignature === calculatedSignature;
  } catch (error) {
    console.error('Error validating webhook signature:', error);
    return false;
  }
}

/**
 * Syncs user data from Firebase to the database
 * @param {Object} userData - User data from Firebase
 * @param {string} eventType - Type of event (created, updated, deleted)
 */
async function syncUserData(userData, eventType) {
  // In test mode, just log the operation without database access
  if (TEST_MODE) {
    console.log(`[TEST MODE] Would sync user data for event: ${eventType}`, userData);
    return;
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { uid, email, displayName, phoneNumber, photoURL, metadata } = userData;
    
    // Parse display name into first and last name
    let firstName = null;
    let lastName = null;
    if (displayName) {
      const nameParts = displayName.trim().split(' ');
      firstName = nameParts[0] || null;
      lastName = nameParts.slice(1).join(' ') || null;
    }
    
    // Extract phone number and country code
    let phoneNumberClean = null;
    let countryCode = null;
    if (phoneNumber) {
      // Remove any non-digit characters except +
      const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
      if (cleanPhone.startsWith('+')) {
        // Extract country code (assuming +1 to +999)
        const match = cleanPhone.match(/^(\+\d{1,3})(\d+)$/);
        if (match) {
          countryCode = match[1];
          phoneNumberClean = match[2];
        } else {
          phoneNumberClean = cleanPhone;
        }
      } else {
        phoneNumberClean = cleanPhone;
      }
    }
    
    switch (eventType) {
      case 'created':
        await handleUserCreated(client, {
          uid,
          email,
          firstName,
          lastName,
          phoneNumber: phoneNumberClean,
          countryCode,
          profileImageUrl: photoURL,
          lastSeen: new Date().toISOString()
        });
        break;
        
      case 'updated':
        await handleUserUpdated(client, {
          uid,
          email,
          firstName,
          lastName,
          phoneNumber: phoneNumberClean,
          countryCode,
          profileImageUrl: photoURL,
          lastSeen: new Date().toISOString()
        });
        break;
        
      case 'deleted':
        await handleUserDeleted(client, uid);
        break;
        
      default:
        throw new Error(`Unknown event type: ${eventType}`);
    }
    
    await client.query('COMMIT');
    console.log(`Successfully synced user ${uid} for event: ${eventType}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error syncing user data for event ${eventType}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Handles user creation event
 * @param {Object} client - Database client
 * @param {Object} userData - User data to insert
 */
async function handleUserCreated(client, userData) {
  const {
    uid,
    email,
    firstName,
    lastName,
    phoneNumber,
    countryCode,
    profileImageUrl,
    lastSeen
  } = userData;
  
  const query = `
    INSERT INTO users (
      id, email, first_name, last_name, phone_number, 
      country_code, profile_image_url, last_seen
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      phone_number = EXCLUDED.phone_number,
      country_code = EXCLUDED.country_code,
      profile_image_url = EXCLUDED.profile_image_url,
      last_seen = EXCLUDED.last_seen
  `;
  
  const values = [
    uid, email, firstName, lastName, phoneNumber, 
    countryCode, profileImageUrl, lastSeen
  ];
  
  await client.query(query, values);
  console.log(`User created/updated: ${uid} (${email})`);
}

/**
 * Handles user update event
 * @param {Object} client - Database client
 * @param {Object} userData - Updated user data
 */
async function handleUserUpdated(client, userData) {
  const {
    uid,
    email,
    firstName,
    lastName,
    phoneNumber,
    countryCode,
    profileImageUrl,
    lastSeen
  } = userData;
  
  const query = `
    UPDATE users SET
      email = $2,
      first_name = $3,
      last_name = $4,
      phone_number = $5,
      country_code = $6,
      profile_image_url = $7,
      last_seen = $8
    WHERE id = $1
  `;
  
  const values = [
    uid, email, firstName, lastName, phoneNumber, 
    countryCode, profileImageUrl, lastSeen
  ];
  
  const result = await client.query(query, values);
  
  if (result.rowCount === 0) {
    // User doesn't exist, create them
    console.log(`User ${uid} not found, creating new user`);
    await handleUserCreated(client, userData);
  } else {
    console.log(`User updated: ${uid} (${email})`);
  }
}

/**
 * Handles user deletion event
 * @param {Object} client - Database client
 * @param {string} uid - Firebase user ID
 */
async function handleUserDeleted(client, uid) {
  const query = 'DELETE FROM users WHERE id = $1';
  const result = await client.query(query, [uid]);
  
  if (result.rowCount > 0) {
    console.log(`User deleted: ${uid}`);
  } else {
    console.log(`User ${uid} not found for deletion`);
  }
}

/**
 * Rate limiting middleware
 */
function rateLimit(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  // Clean up old entries
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now - data.firstRequest > RATE_LIMIT_WINDOW) {
      rateLimitStore.delete(ip);
    }
  }
  
  const clientData = rateLimitStore.get(clientIP);
  
  if (!clientData) {
    rateLimitStore.set(clientIP, {
      firstRequest: now,
      requestCount: 1
    });
    return next();
  }
  
  if (now - clientData.firstRequest > RATE_LIMIT_WINDOW) {
    // Reset window
    rateLimitStore.set(clientIP, {
      firstRequest: now,
      requestCount: 1
    });
    return next();
  }
  
  if (clientData.requestCount >= RATE_LIMIT_MAX_REQUESTS) {
    console.warn(`Rate limit exceeded for IP: ${clientIP}`);
    return res.status(429).json({ 
      error: 'Too many requests',
      retryAfter: Math.ceil((RATE_LIMIT_WINDOW - (now - clientData.firstRequest)) / 1000)
    });
  }
  
  clientData.requestCount++;
  next();
}

/**
 * Request timeout middleware
 */
function requestTimeout(req, res, next) {
  req.setTimeout(REQUEST_TIMEOUT, () => {
    console.error(`Request timeout for ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  next();
}

/**
 * Request size validation middleware
 */
function validateRequestSize(req, res, next) {
  const contentLength = parseInt(req.get('content-length') || '0');
  
  if (contentLength > MAX_REQUEST_SIZE) {
    console.error(`Request too large: ${contentLength} bytes`);
    return res.status(413).json({ error: 'Request too large' });
  }
  
  next();
}

/**
 * Middleware to validate webhook signature
 */
function validateSignature(req, res, next) {
  const signature = req.get('X-Hub-Signature-256') || req.get('X-Firebase-Signature');
  const payload = JSON.stringify(req.body);
  
  if (!validateWebhookSignature(signature, payload)) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  next();
}

/**
 * Error handling middleware for Firebase webhooks
 */
function handleWebhookError(err, req, res, next) {
  console.error('Firebase webhook error:', err);
  
  if (res.headersSent) {
    return next(err);
  }
  
  // Database connection errors
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    return res.status(503).json({ 
      error: 'Database unavailable',
      retryAfter: 30
    });
  }
  
  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ 
      error: 'Invalid request data',
      details: err.message
    });
  }
  
  // Default error
  res.status(500).json({ 
    error: 'Internal server error',
    requestId: req.id || 'unknown'
  });
}

/**
 * POST /webhooks/firebase/user-created
 * Handles Firebase user creation events
 */
router.post('/user-created', 
  rateLimit,
  requestTimeout,
  validateRequestSize,
  validateSignature,
  async (req, res) => {
  try {
    console.log('Firebase user-created webhook received');
    
    const { data } = req.body;
    if (!data || !data.uid) {
      return res.status(400).json({ error: 'Invalid user data' });
    }
    
    await syncUserData(data, 'created');
    
    res.status(200).json({ 
      message: 'User created successfully',
      userId: data.uid 
    });
    
  } catch (error) {
    console.error('Error handling user-created webhook:', error);
    res.status(500).json({ 
      error: 'Failed to process user creation',
      details: error.message 
    });
  }
});

/**
 * POST /webhooks/firebase/user-updated
 * Handles Firebase user update events
 */
router.post('/user-updated', 
  rateLimit,
  requestTimeout,
  validateRequestSize,
  validateSignature,
  async (req, res) => {
  try {
    console.log('Firebase user-updated webhook received');
    
    const { data } = req.body;
    if (!data || !data.uid) {
      return res.status(400).json({ error: 'Invalid user data' });
    }
    
    await syncUserData(data, 'updated');
    
    res.status(200).json({ 
      message: 'User updated successfully',
      userId: data.uid 
    });
    
  } catch (error) {
    console.error('Error handling user-updated webhook:', error);
    res.status(500).json({ 
      error: 'Failed to process user update',
      details: error.message 
    });
  }
});

/**
 * POST /webhooks/firebase/user-deleted
 * Handles Firebase user deletion events
 */
router.post('/user-deleted', 
  rateLimit,
  requestTimeout,
  validateRequestSize,
  validateSignature,
  async (req, res) => {
  try {
    console.log('Firebase user-deleted webhook received');
    
    const { data } = req.body;
    if (!data || !data.uid) {
      return res.status(400).json({ error: 'Invalid user data' });
    }
    
    await syncUserData(data, 'deleted');
    
    res.status(200).json({ 
      message: 'User deleted successfully',
      userId: data.uid 
    });
    
  } catch (error) {
    console.error('Error handling user-deleted webhook:', error);
    res.status(500).json({ 
      error: 'Failed to process user deletion',
      details: error.message 
    });
  }
});

/**
 * Health check endpoint for Firebase webhooks
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'firebase-webhooks',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Apply error handling middleware
router.use(handleWebhookError);

module.exports = router;
