#!/usr/bin/env node
import { Command } from 'commander';
import { summarizeCommand } from './commands/summarize.js';
import { cacheCommand } from './commands/cache.js';
import { testConnectionCommand } from './commands/test.js';
import { configureCommand } from './commands/configure.js';
import { registerCleanupHandlers } from '../core/cache/db.js';

// Register cleanup handlers for graceful database shutdown
registerCleanupHandlers();

const program = new Command();

program
  .name('slack-summarizer')
  .description('Summarize Slack activity over time')
  .version('1.0.0');

program
  .command('summarize')
  .description('Generate activity summary')
  .option('-d, --date <date>', 'Target date (today, yesterday, YYYY-MM-DD)', 'today')
  .option('-s, --span <span>', 'Time span (day, week)', 'day')
  .option('-f, --format <format>', 'Output format (json, markdown)', 'json')
  .option('-o, --output <file>', 'Output file path (defaults based on format)')
  .option('-m, --model <model>', 'Claude model (haiku, sonnet)', 'haiku')
  .option('-u, --user <userId>', 'Slack user ID (defaults to token owner)')
  .action(summarizeCommand);

program
  .command('cache')
  .description('Manage cache')
  .option('--clear', 'Clear all cached data')
  .option('--stats', 'Show cache statistics')
  .action(cacheCommand);

program
  .command('test-connection')
  .description('Test Slack and Claude API connections')
  .action(testConnectionCommand);

program
  .command('configure')
  .description('Interactive configuration setup')
  .option('--reset', 'Reset configuration (ignore existing values)')
  .action(configureCommand);

program.parse();
