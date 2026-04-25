const { Pool } = require('pg');

function buildConnectionStringFromParts() {
  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT;
  const db = process.env.POSTGRES_DB;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;

  if (!host || !port || !db || !user) return null;
  const encodedPassword = password ? encodeURIComponent(password) : '';
  const auth = encodedPassword ? `${encodeURIComponent(user)}:${encodedPassword}` : encodeURIComponent(user);
  return `postgres://${auth}@${host}:${port}/${db}`;
}

let pool;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL || buildConnectionStringFromParts();
  if (!connectionString) {
    throw new Error(
      'Database connection not configured. Set DATABASE_URL or POSTGRES_HOST/PORT/DB/USER/PASSWORD.'
    );
  }

  pool = new Pool({ connectionString });
  return pool;
}

module.exports = { getPool };
