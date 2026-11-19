import { getDatabase, transaction } from './db.js';
import type { SlackUser } from '@/core/models/slack.js';

/** Past this age the directory is rebuilt, which picks up renamed and departed users */
export const CONNECT_DIRECTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function saveConnectUsers(teamId: string, users: SlackUser[]): void {
  const fetchedAt = Date.now();
  transaction((db) => {
    db.prepare('DELETE FROM connect_users WHERE team_id = ?').run(teamId);
    const insert = db.prepare(
      'INSERT INTO connect_users (team_id, user_id, raw_json, fetched_at) VALUES (?, ?, ?, ?)'
    );
    for (const user of users) {
      insert.run(teamId, user.id, JSON.stringify(user), fetchedAt);
    }
  });
}

/** The team's stored directory, or null when none is stored or it has expired */
export function loadConnectUsers(
  teamId: string,
  maxAgeMs: number = CONNECT_DIRECTORY_MAX_AGE_MS
): SlackUser[] | null {
  const rows = getDatabase()
    .prepare('SELECT raw_json, fetched_at FROM connect_users WHERE team_id = ?')
    .all(teamId) as Array<{ raw_json: string; fetched_at: number }>;

  if (rows.length === 0) return null;
  const oldest = Math.min(...rows.map((r) => r.fetched_at));
  if (Date.now() - oldest > maxAgeMs) return null;

  return rows.map((r) => JSON.parse(r.raw_json) as SlackUser);
}

export const sqliteUserDirectory = {
  load: (teamId: string) => loadConnectUsers(teamId),
  save: saveConnectUsers,
};
