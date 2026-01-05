import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import { getEnv } from '../../utils/env.js';
import { logger } from '../../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = getEnv().SLACK_SUMMARIZER_DB_PATH;

  // Ensure the directory exists with restricted permissions
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true, mode: 0o700 });
    logger.info('Created cache directory', { path: dbDir });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  initializeSchema(db);

  logger.info('Database initialized', { path: dbPath });
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
    logger.error('Uncaught exception, closing database', { error: error.message });
    cleanup();
    process.exit(1);
  });

  cleanupRegistered = true;
  logger.debug('Database cleanup handlers registered');
}
