import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getJobByUrl } from '../lib/supabase.js';
import { answerApplicationQuestion } from '../lib/generator.js';

export const qaCommand = new Command('qa')
  .description('Answer an application question for a tracked job')
  .argument('<url>', 'URL of the job (must already be added with jobreach add)')
  .argument('<question>', 'The application question to answer')
  .action(async (url: string, question: string) => {
    const spinner = ora('Looking up job...').start();
    const job = await getJobByUrl(url).catch(() => null);
    if (!job) {
      spinner.fail(`No job found for that URL. Run "jobreach add <url>" first.`);
      process.exit(1);
    }
    spinner.text = `Drafting answer for ${chalk.bold(job.title)} at ${chalk.bold(job.company)}...`;

    let answer: string;
    try {
      answer = await answerApplicationQuestion(job, question);
      spinner.succeed('Done');
    } catch (e) {
      spinner.fail(`Failed: ${e}`);
      process.exit(1);
    }

    console.log('\n' + chalk.bold.cyan('  QUESTION'));
    console.log('  ' + chalk.dim(question));
    console.log('\n' + chalk.bold.cyan('  ANSWER'));
    console.log(answer.split('\n').map(l => '  ' + l).join('\n'));
    console.log();
  });
