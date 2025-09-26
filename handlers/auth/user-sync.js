import { GraphQLClient } from "graphql-request";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Initialize GraphQL client for Hasura
const hasuraClient = new GraphQLClient(process.env.HASURA_GRAPHQL_ENDPOINT || "http://localhost:8080/v1/graphql", {
  headers: {
    "X-Hasura-Admin-Secret": process.env.HASURA_GRAPHQL_ADMIN_SECRET || "myadminsecretkey",
  },
});

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@postgres:5432/postgres',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Syncs Firebase user data to PostgreSQL database
 * @param {Object} firebaseUser - Firebase user object
 * @param {Object} additionalData - Additional user data (custom claims, etc.)
 * @returns {Promise<Object>} - Sync result with success status and user data
 */
export async function syncUserToDatabase(firebaseUser, additionalData = {}) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { uid, email, displayName, phoneNumber, photoURL, metadata } = firebaseUser;
    const { customClaims = {}, role = 'user' } = additionalData;
    
    // Parse display name into first and last name
    let firstName = null;
    let lastName = null;
    if (displayName) {
      const nameParts = displayName.trim().split(' ');
      firstName = nameParts[0] || null;
      lastName = nameParts.slice(1).join(' ') || null;
    }
    
    // Clean phone number
    let phoneNumberClean = null;
    if (phoneNumber) {
      phoneNumberClean = phoneNumber.replace(/[^\d+]/g, '');
    }
    
    // Prepare user data for insertion/update
    const userData = {
      id: uid,
      email: email,
      first_name: firstName,
      last_name: lastName,
      phone_number: phoneNumberClean,
      created_at: metadata?.creationTime ? new Date(metadata.creationTime) : new Date(),
      updated_at: metadata?.lastSignInTime ? new Date(metadata.lastSignInTime) : new Date()
    };
    
    // Use UPSERT (INSERT ... ON CONFLICT) to handle conflicts
    const upsertQuery = `
      INSERT INTO users (id, email, first_name, last_name, phone_number, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (email) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        phone_number = EXCLUDED.phone_number,
        updated_at = EXCLUDED.updated_at
      RETURNING *;
    `;
    
    const values = [
      userData.id,
      userData.email,
      userData.first_name,
      userData.last_name,
      userData.phone_number,
      userData.created_at,
      userData.updated_at
    ];
    
    const result = await client.query(upsertQuery, values);
    const syncedUser = result.rows[0];
    
    await client.query('COMMIT');
    
    // Log successful sync
    await logToDatabase('info', 'User synced successfully', {
      userId: uid,
      email: email,
      action: 'sync'
    });
    
    return {
      success: true,
      user: syncedUser,
      message: 'User synced successfully'
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    
    // Log error
    await logToDatabase('error', 'Failed to sync user', {
      userId: firebaseUser.uid,
      email: firebaseUser.email,
      error: error.message
    });
    
    console.error('Error syncing user to database:', error);
    
    return {
      success: false,
      error: error.message,
      message: 'Failed to sync user to database'
    };
  } finally {
    client.release();
  }
}

/**
 * Handles user creation events from Firebase
 * @param {Object} firebaseUser - Firebase user object
 * @param {Object} additionalData - Additional user data
 * @returns {Promise<Object>} - Creation result
 */
export async function handleUserCreation(firebaseUser, additionalData = {}) {
  try {
    // Validate required fields
    if (!firebaseUser.uid || !firebaseUser.email) {
      throw new Error('Missing required user fields: uid or email');
    }
    
    // Check if user already exists
    const existingUser = await getUserByEmail(firebaseUser.email);
    if (existingUser) {
      return await resolveUserConflicts(firebaseUser, existingUser, additionalData);
    }
    
    // Sync new user to database
    const result = await syncUserToDatabase(firebaseUser, additionalData);
    
    if (result.success) {
      await logToDatabase('info', 'New user created and synced', {
        userId: firebaseUser.uid,
        email: firebaseUser.email
      });
    }
    
    return result;
    
  } catch (error) {
    await logToDatabase('error', 'Failed to handle user creation', {
      userId: firebaseUser.uid,
      email: firebaseUser.email,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message,
      message: 'Failed to handle user creation'
    };
  }
}

/**
 * Handles user update events from Firebase
 * @param {Object} firebaseUser - Updated Firebase user object
 * @param {Object} additionalData - Additional user data
 * @returns {Promise<Object>} - Update result
 */
export async function handleUserUpdates(firebaseUser, additionalData = {}) {
  try {
    // Validate required fields
    if (!firebaseUser.uid || !firebaseUser.email) {
      throw new Error('Missing required user fields: uid or email');
    }
    
    // Get existing user from database
    const existingUser = await getUserByEmail(firebaseUser.email);
    if (!existingUser) {
      // User doesn't exist, create them
      return await handleUserCreation(firebaseUser, additionalData);
    }
    
    // Update existing user
    const result = await syncUserToDatabase(firebaseUser, additionalData);
    
    if (result.success) {
      await logToDatabase('info', 'User updated and synced', {
        userId: firebaseUser.uid,
        email: firebaseUser.email
      });
    }
    
    return result;
    
  } catch (error) {
    await logToDatabase('error', 'Failed to handle user updates', {
      userId: firebaseUser.uid,
      email: firebaseUser.email,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message,
      message: 'Failed to handle user updates'
    };
  }
}

/**
 * Resolves conflicts between Firebase and database users
 * @param {Object} firebaseUser - Firebase user object
 * @param {Object} existingUser - Existing database user
 * @param {Object} additionalData - Additional user data
 * @returns {Promise<Object>} - Conflict resolution result
 */
export async function resolveUserConflicts(firebaseUser, existingUser, additionalData = {}) {
  try {
    // Check if Firebase UID matches database ID
    if (firebaseUser.uid === existingUser.id) {
      // Same user, update with latest Firebase data
      return await syncUserToDatabase(firebaseUser, additionalData);
    }
    
    // Different UIDs but same email - this is a conflict
    await logToDatabase('warn', 'User conflict detected', {
      firebaseUid: firebaseUser.uid,
      databaseId: existingUser.id,
      email: firebaseUser.email
    });
    
    // For now, update the existing user with Firebase data
    // In production, you might want more sophisticated conflict resolution
    const result = await syncUserToDatabase(firebaseUser, additionalData);
    
    return {
      ...result,
      conflictResolved: true,
      message: 'User conflict resolved by updating with Firebase data'
    };
    
  } catch (error) {
    await logToDatabase('error', 'Failed to resolve user conflicts', {
      firebaseUid: firebaseUser.uid,
      databaseId: existingUser.id,
      email: firebaseUser.email,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message,
      message: 'Failed to resolve user conflicts'
    };
  }
}

/**
 * Gets user by email from database
 * @param {string} email - User email
 * @returns {Promise<Object|null>} - User object or null
 */
async function getUserByEmail(email) {
  const client = await pool.connect();
  
  try {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await client.query(query, [email]);
    
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by email:', error);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Validates user sync data
 * @param {Object} firebaseUser - Firebase user object
 * @param {Object} additionalData - Additional user data
 * @returns {Object} - Validation result
 */
export function validateSyncData(firebaseUser, additionalData = {}) {
  const errors = [];
  
  // Required fields validation
  if (!firebaseUser.uid) {
    errors.push('Firebase UID is required');
  }
  
  if (!firebaseUser.email) {
    errors.push('Email is required');
  }
  
  // Email format validation
  if (firebaseUser.email && !isValidEmail(firebaseUser.email)) {
    errors.push('Invalid email format');
  }
  
  // Phone number validation (if provided)
  if (firebaseUser.phoneNumber && !isValidPhoneNumber(firebaseUser.phoneNumber)) {
    errors.push('Invalid phone number format');
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} - Whether email is valid
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates phone number format
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} - Whether phone number is valid
 */
export function isValidPhoneNumber(phoneNumber) {
  // Basic phone number validation (allows international format)
  const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
  return phoneRegex.test(phoneNumber.replace(/[\s\-\(\)]/g, ''));
}

/**
 * Logs messages to database
 * @param {string} level - Log level (info, warn, error)
 * @param {string} message - Log message
 * @param {Object} details - Additional details
 */
async function logToDatabase(level, message, details = {}) {
  const mutation = `
    mutation InsertLog($level: String!, $message: String!, $details: jsonb!) {
      insert_logs(objects: { level: $level, message: $message, details: $details }) {
        affected_rows
      }
    }
  `;

  try {
    await hasuraClient.request(mutation, { level, message, details });
  } catch (error) {
    console.error(`Failed to insert log: ${error.message}`);
  }
}

/**
 * Main sync function that handles all user synchronization
 * @param {Object} firebaseUser - Firebase user object
 * @param {string} eventType - Event type (created, updated, deleted)
 * @param {Object} additionalData - Additional user data
 * @returns {Promise<Object>} - Sync result
 */
export async function syncUser(firebaseUser, eventType = 'created', additionalData = {}) {
  try {
    // Validate sync data
    const validation = validateSyncData(firebaseUser, additionalData);
    if (!validation.isValid) {
      return {
        success: false,
        errors: validation.errors,
        message: 'Invalid sync data'
      };
    }
    
    // Handle different event types
    switch (eventType) {
      case 'created':
        return await handleUserCreation(firebaseUser, additionalData);
      case 'updated':
        return await handleUserUpdates(firebaseUser, additionalData);
      case 'deleted':
        // Handle user deletion if needed
        await logToDatabase('info', 'User deletion event received', {
          userId: firebaseUser.uid,
          email: firebaseUser.email
        });
        return {
          success: true,
          message: 'User deletion event logged'
        };
      default:
        return await handleUserUpdates(firebaseUser, additionalData);
    }
    
  } catch (error) {
    await logToDatabase('error', 'Failed to sync user', {
      userId: firebaseUser.uid,
      email: firebaseUser.email,
      eventType: eventType,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message,
      message: 'Failed to sync user'
    };
  }
}
