/**
 * Test utilities for database operations.
 *
 * Provides helpers for creating in-memory SQLite databases that mirror
 * the production schema, enabling isolated database testing without
 * affecting real data.
 *
 * IMPORTANT: This module creates databases directly without going through
 * the production getDatabase() singleton, which allows tests to mock
 * getDatabase() while still using these helpers.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the schema file relative to this file
const SCHEMA_PATH = join(__dirname, '../../src/core/cache/schema.sql');

/**
 * Initialize the database schema from schema.sql
 */
function initializeSchema(db: Database.Database): void {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    db.exec(statement);
  }
}

/**
 * Creates a fresh in-memory database with the production schema.
 * Each call returns a new, isolated database instance.
 *
 * This function creates the database directly without using the production
 * getDatabase() function, which allows it to be used even when getDatabase()
 * is being mocked in tests.
 *
 * @example
 * ```typescript
 * let db: Database.Database;
 *
 * beforeEach(() => {
 *   db = createTestDatabase();
 * });
 *
 * afterEach(() => {
 *   db.close();
 * });
 * ```
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}

/**
 * Helper for setting up and tearing down test databases.
 * Returns a cleanup function to be called in afterEach.
 *
 * @example
 * ```typescript
 * let cleanup: () => void;
 *
 * beforeEach(() => {
 *   cleanup = setupTestDatabase();
 * });
 *
 * afterEach(() => {
 *   cleanup();
 * });
 * ```
 */
export function setupTestDatabase(): { db: Database.Database; cleanup: () => void } {
  const db = createTestDatabase();
  return {
    db,
    cleanup: () => {
      db.close();
    },
  };
}

/**
 * Wraps a test function with database setup and cleanup.
 * Useful for single tests that need isolated database access.
 *
 * @example
 * ```typescript
 * it('should store data', async () => {
 *   await withTestDatabase(async (db) => {
 *     db.prepare('INSERT INTO messages ...').run(...);
 *     const result = db.prepare('SELECT * FROM messages').all();
 *     expect(result).toHaveLength(1);
 *   });
 * });
 * ```
 */
export async function withTestDatabase<T>(
  fn: (db: Database.Database) => T | Promise<T>
): Promise<T> {
  const db = createTestDatabase();
  try {
    return await Promise.resolve(fn(db));
  } finally {
    db.close();
  }
}

/**
 * Creates test embedding data for use in tests.
 * Generates a Float32Array with the specified dimensions.
 */
export function createTestEmbedding(dimensions = 1536): number[] {
  return Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
}

/**
 * Compares two embedding arrays for approximate equality.
 * Useful for testing serialization/deserialization round-trips.
 */
export function expectEmbeddingsEqual(
  actual: number[],
  expected: number[],
  precision = 0.0001
): void {
  if (actual.length !== expected.length) {
    throw new Error(`Embedding length mismatch: ${actual.length} vs ${expected.length}`);
  }
  for (let i = 0; i < actual.length; i++) {
    const diff = Math.abs(actual[i] - expected[i]);
    if (diff > precision) {
      throw new Error(
        `Embedding value mismatch at index ${i}: ${actual[i]} vs ${expected[i]} (diff: ${diff})`
      );
    }
  }
}
