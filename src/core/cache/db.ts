import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import { getEnv } from '@/utils/env.js';
import { createLogger } from '@/utils/logging/index.js';

const logger = createLogger({ component: 'Database' });

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

/**
 * Get or create the database connection.
 * @param dbPath Optional path override. Use ':memory:' for in-memory database (useful for testing).
 *               When ':memory:' is used, a new database instance is returned without caching.
 */
export function getDatabase(dbPath?: string): Database.Database {
  const finalPath = dbPath ?? getEnv().SLACK_SUMMARIZER_DB_PATH;

  // For in-memory databases, always create a new instance (don't use singleton)
  if (finalPath === ':memory:') {
    const memDb = new Database(':memory:');
    memDb.pragma('journal_mode = WAL');
    memDb.pragma('foreign_keys = ON');
    initializeSchema(memDb);
    logger.debug('In-memory database initialized');
    return memDb;
  }

  // For file-based databases, use singleton pattern
  if (db) {
    return db;
  }

  // Ensure the directory exists with restricted permissions
  const dbDir = dirname(finalPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true, mode: 0o700 });
    logger.debug({ path: dbDir }, 'Created cache directory');
  }

  db = new Database(finalPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  initializeSchema(db);

  logger.debug({ path: finalPath }, 'Database initialized');
  return db;
}

function initializeSchema(database: Database.Database): void {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // Split by semicolons and execute each statement
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    database.exec(statement);
  }

  logger.debug('Database schema initialized');
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.debug('Database closed');
  }
}

export function resetDatabase(): void {
  closeDatabase();
}

// Helper for running in transactions
export function transaction<T>(fn: (db: Database.Database) => T): T {
  const database = getDatabase();
  return database.transaction(fn)(database);
}

// Register cleanup handlers for graceful shutdown
let cleanupRegistered = false;

export function registerCleanupHandlers(): void {
  if (cleanupRegistered) {
    return;
  }

  const cleanup = () => {
    closeDatabase();
  };

  // Handle normal exit
  process.on('exit', cleanup);

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  // Handle SIGTERM (kill command)
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'Uncaught exception, closing database');
    cleanup();
    process.exit(1);
  });

  cleanupRegistered = true;
  logger.debug('Database cleanup handlers registered');
}
