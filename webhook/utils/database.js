const { Pool } = require("pg");
const { logger } = require("./logger");

// Create PostgreSQL connection pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
  database: process.env.POSTGRES_DB || "safetrust_db",
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on("connect", () => {
  logger.info("PostgreSQL client connected to database");
});

pool.on("error", (err) => {
  logger.error("Unexpected error on idle PostgreSQL client", {
    error: err.message,
  });
});

/**
 * Execute a SQL query
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug("Executed query", { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error("Database query error", {
      error: error.message,
      query: text,
    });
    throw error;
  }
}

/**
 * Get a client from the pool
 */
async function getClient() {
  const client = await pool.connect();
  return client;
}

module.exports = {
  query,
  getClient,
  pool,
};
