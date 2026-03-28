import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  
  // Using the same database connection URL as the worker
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  
  if (!connectionString) {
    if (process.env.npm_lifecycle_event === 'build') {
      console.warn('POSTGRES_URL or DATABASE_URL environment variable is not set. Using dummy pool for build.');
      pool = new Pool();
      return pool;
    }
    throw new Error('POSTGRES_URL or DATABASE_URL environment variable is not set');
  }

  // Create a single connection pool instance
  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
  
  return pool;
}

// Helper for executing queries
export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  try {
    const res = await getPool().query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Initialize the users table
export async function initializeDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'user',
      linkedin_email VARCHAR(255),
      linkedin_connected BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  try {
    await query(createTableQuery);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

// Run initialization immediately on file load, but don't block
if (process.env.npm_lifecycle_event !== 'build') {
  initializeDatabase().catch(console.error);
}

export default pool;
