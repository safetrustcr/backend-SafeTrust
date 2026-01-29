const { Pool } = require('pg');
require('dotenv').config();

/**
 * Database connection pool for webhook handlers
 * Reuses the same connection pattern as other webhook handlers
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.PG_DATABASE_URL || 'postgres://postgres:postgrespassword@postgres:5432/postgres',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Execute a database query
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Get a single client from the pool for transactions
 * @returns {Promise<Object>} Database client
 */
async function getClient() {
  return await pool.connect();
}

module.exports = {
  query,
  getClient,
  pool,
};
