import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConnectUsers, saveConnectUsers } from '@/core/cache/users.js';
import { resetDatabase } from '@/core/cache/db.js';
import { resetEnvCache } from '@/utils/env.js';
import type { SlackUser } from '@/core/models/slack.js';

const kelly: SlackUser = { id: 'UEXT1', name: 'kelly.lake', real_name: 'Kelly Lake' };
const val: SlackUser = { id: 'UEXT2', name: 'val.b', real_name: 'Valerie Bullinger', display_name: 'Val' };

describe('Connect user directory cache', () => {
  beforeEach(() => {
    resetEnvCache();
    resetDatabase();
    process.env.SLACK_USER_TOKEN = 'xoxp-test-token';
    process.env.SLACK_SUMMARIZER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'users-cache-')), 'test.db');
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDatabase();
    resetEnvCache();
  });

  it('should round-trip a team directory', () => {
    saveConnectUsers('T1', [kelly, val]);

    const users = loadConnectUsers('T1');
    expect(users).toHaveLength(2);
    expect(users).toEqual(expect.arrayContaining([kelly, val]));
  });

  it('should keep directories separate per team', () => {
    saveConnectUsers('T1', [kelly]);

    expect(loadConnectUsers('T2')).toBeNull();
  });

  it('should return null once the directory is older than the max age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    saveConnectUsers('T1', [kelly]);

    vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));
    expect(loadConnectUsers('T1', 7 * 24 * 60 * 60 * 1000)).toBeNull();
    expect(loadConnectUsers('T1', 10 * 24 * 60 * 60 * 1000)).toEqual([kelly]);
  });

  it('should replace the previous directory for a team on save', () => {
    saveConnectUsers('T1', [kelly, val]);
    saveConnectUsers('T1', [val]);

    expect(loadConnectUsers('T1')).toEqual([val]);
  });
});
