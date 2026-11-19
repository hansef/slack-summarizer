import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Keep tests away from the developer's real config file (which holds tokens
// and overrides defaults) and cache database
const root = mkdtempSync(join(tmpdir(), 'slack-summarizer-test-'));
process.env.XDG_CONFIG_HOME = join(root, 'config');
process.env.XDG_DATA_HOME = join(root, 'data');
