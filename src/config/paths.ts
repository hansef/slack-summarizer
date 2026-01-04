import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_NAME = 'slack-summarizer';
const CONFIG_FILENAME = 'config.toml';

/**
 * Get the configuration directory path.
 * Follows XDG Base Directory Specification.
 *
 * Priority:
 * 1. $XDG_CONFIG_HOME/slack-summarizer (if XDG_CONFIG_HOME is set)
 * 2. ~/.config/slack-summarizer (default)
 */
export function getConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const baseDir = xdgConfigHome || join(homedir(), '.config');
  return join(baseDir, APP_NAME);
}

/**
 * Get the full path to the config file.
 */
export function getConfigFilePath(): string {
  return join(getConfigDir(), CONFIG_FILENAME);
}

/**
 * Check if a config file exists.
 */
export function configFileExists(): boolean {
  return existsSync(getConfigFilePath());
}

/**
 * Ensure the config directory exists.
 * Creates it with restricted permissions (0700) if missing.
 */
export function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get a user-friendly display path (with ~ for home directory).
 */
export function getDisplayPath(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) {
    return path.replace(home, '~');
  }
  return path;
}
