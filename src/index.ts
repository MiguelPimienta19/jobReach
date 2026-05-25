import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { findProjectRoot } from './lib/projectRoot.js';
import { Command } from 'commander';
import { addCommand } from './commands/add.js';
import { qaCommand } from './commands/qa.js';
import { listCommand } from './commands/list.js';

// ============================================================================
// Env Loading
// ============================================================================

// dotenv reads from process.cwd() by default — that breaks the globally-linked
// binary when invoked from outside the project dir. Resolve .env from the same
// project root used by config/context loaders.
const envRoot = findProjectRoot('.env');

if (envRoot) {
  loadDotenv({ path: join(envRoot, '.env') });
} else {
  loadDotenv();
}

// ============================================================================
// CLI Entry
// ============================================================================

const program = new Command();
program.name('jobreach').description('Personal job search assistant').version('1.0.0');
program.addCommand(addCommand);
program.addCommand(qaCommand);
program.addCommand(listCommand);
program.parse(process.argv);
