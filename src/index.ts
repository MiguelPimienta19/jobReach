import 'dotenv/config';
import { Command } from 'commander';
import { addCommand } from './commands/add.js';
import { qaCommand } from './commands/qa.js';

const program = new Command();
program.name('jobreach').description('Personal job search assistant').version('1.0.0');
program.addCommand(addCommand);
program.addCommand(qaCommand);
program.parse(process.argv);
