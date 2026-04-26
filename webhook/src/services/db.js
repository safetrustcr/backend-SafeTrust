const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
  database: process.env.POSTGRES_DB || 'postgres',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgrespassword',
});

// Handle pool errors to prevent process crash
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

module.exports = {
  /**
   * Execute a SQL query against the database pool.
   * 
   * @param {string} text - SQL query text
   * @param {any[]} params - Query parameters
   * @returns {Promise<import('pg').QueryResult>}
   */
  query: (text, params) => pool.query(text, params),
  
  /**
   * The underlying pg Pool instance.
   * @type {import('pg').Pool}
   */
  pool,
};
