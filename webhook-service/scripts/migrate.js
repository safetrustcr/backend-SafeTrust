require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Configure database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigrations() {
  console.log('Starting database migrations...');
  
  try {
    // Create migrations table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    // Get list of applied migrations
    const result = await pool.query('SELECT name FROM migrations');
    const appliedMigrations = result.rows.map(row => row.name);
    
    // Get list of migration files
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    // Apply migrations that haven't been applied yet
    for (const file of migrationFiles) {
      if (!appliedMigrations.includes(file)) {
        console.log(`Applying migration: ${file}`);
        
        // Read migration file
        const migration = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        
        // Start a transaction
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          
          // Run the migration
          await client.query(migration);
          
          // Record the migration
          await client.query(
            'INSERT INTO migrations (name) VALUES ($1)',
            [file]
          );
          
          await client.query('COMMIT');
          console.log(`Migration ${file} applied successfully`);
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`Error applying migration ${file}:`, error);
          process.exit(1);
        } finally {
          client.release();
        }
      } else {
        console.log(`Migration ${file} already applied, skipping`);
      }
    }
    
    console.log('All migrations applied successfully');
  } catch (error) {
    console.error('Error running migrations:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations(); 