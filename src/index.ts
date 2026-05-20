import 'dotenv/config';
import { Command } from 'commander';
import { addCommand } from './commands/add.js';
import { qaCommand } from './commands/qa.js';
import { listCommand } from './commands/list.js';
import { connectCommand } from './commands/connect.js';

// ============================================================================
// CLI Entry
// ============================================================================

const program = new Command();
program.name('jobreach').description('Personal job search assistant').version('1.0.0');
program.addCommand(addCommand);
program.addCommand(qaCommand);
program.addCommand(listCommand);
program.addCommand(connectCommand);
program.parse(process.argv);
