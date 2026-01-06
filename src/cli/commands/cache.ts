import { existsSync, unlinkSync, statSync } from 'node:fs';
import { getEnv } from '@/utils/env.js';
import { getDatabase } from '@/core/cache/db.js';
import { output } from '../output.js';
import { logger } from '@/utils/logger.js';

interface CacheOptions {
  clear?: boolean;
  stats?: boolean;
}

export function cacheCommand(options: CacheOptions): void {
  const dbPath = getEnv().SLACK_SUMMARIZER_DB_PATH;

  if (!options.clear && !options.stats) {
    output.info('Usage: slack-summarizer cache [--clear | --stats]');
    output.info('');
    output.info('Options:');
    output.info('  --clear    Clear all cached data');
    output.info('  --stats    Show cache statistics');
    return;
  }

  if (options.clear) {
    clearCache(dbPath);
    return;
  }

  if (options.stats) {
    showCacheStats(dbPath);
    return;
  }
}

function clearCache(dbPath: string): void {
  output.warn('This will delete all cached Slack data.');
  output.info(`Cache file: ${dbPath}`);

  try {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
      output.success('Cache cleared successfully');
      logger.info('Cache cleared', { path: dbPath });
    } else {
      output.info('No cache file found - nothing to clear');
    }
  } catch (error) {
    logger.error('Failed to clear cache', {
      error: error instanceof Error ? error.message : String(error),
    });
    output.error(
      'Failed to clear cache',
      error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}

function showCacheStats(dbPath: string): void {
  if (!existsSync(dbPath)) {
    output.info('No cache file found');
    output.info(`Expected location: ${dbPath}`);
    return;
  }

  try {
    const stats = statSync(dbPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    output.header('Cache Statistics');
    output.divider();
    output.stat('Cache File', dbPath);
    output.stat('File Size', `${sizeMB} MB`);
    output.stat('Created', stats.birthtime.toISOString());
    output.stat('Modified', stats.mtime.toISOString());

    // Get database statistics
    const db = getDatabase();

    const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get() as {
      count: number;
    };
    const mentionCount = db.prepare('SELECT COUNT(*) as count FROM mentions').get() as {
      count: number;
    };
    const reactionCount = db.prepare('SELECT COUNT(*) as count FROM reactions').get() as {
      count: number;
    };
    const channelCount = db.prepare('SELECT COUNT(*) as count FROM channels').get() as {
      count: number;
    };

    output.divider();
    output.header('Cached Records');
    output.stat('Messages', messageCount.count);
    output.stat('Mentions', mentionCount.count);
    output.stat('Reactions', reactionCount.count);
    output.stat('Channels', channelCount.count);

    // Get date range
    const dateRange = db
      .prepare(
        `
      SELECT
        MIN(day_bucket) as oldest,
        MAX(day_bucket) as newest
      FROM messages
    `
      )
      .get() as { oldest: string | null; newest: string | null };

    if (dateRange.oldest && dateRange.newest) {
      output.divider();
      output.header('Date Range');
      output.stat('Oldest Data', dateRange.oldest);
      output.stat('Newest Data', dateRange.newest);
    }
  } catch (error) {
    logger.error('Failed to read cache stats', {
      error: error instanceof Error ? error.message : String(error),
    });
    output.error(
      'Failed to read cache statistics',
      error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}
