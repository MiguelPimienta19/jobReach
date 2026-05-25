import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { select, input } from '@inquirer/prompts';
import { getJobByUrl, listJobs } from '../lib/supabase.js';
import { answerApplicationQuestion } from '../lib/generator.js';
import { copyMenu } from '../lib/copyMenu.js';

// ============================================================================
// Command Definition
// ============================================================================

export const qaCommand = new Command('qa')
  .description('Answer an application question for a tracked job')
  .argument('[url]', 'URL of the job (omit to use --pick)')
  .argument('[question]', 'The application question to answer (omit to use --pick)')
  .option('--pick', 'Interactively pick a job from your tracked applications')
  .action(async (urlArg: string | undefined, questionArg: string | undefined, opts: { pick?: boolean }) => {
    let url = urlArg;
    let question = questionArg;

    if (opts.pick || !url) {
      const jobs = await listJobs().catch(() => []);
      if (jobs.length === 0) {
        console.log(chalk.yellow('\n  No jobs tracked yet. Run "jobreach add <url>" first.\n'));
        process.exit(1);
      }
      const chosen = await select({
        message: 'Pick a job:',
        choices: jobs.map(j => ({ name: `${j.company} — ${j.title}  (${j.status})`, value: j.url })),
      });
      url = chosen;
    }

    if (!question) {
      question = await input({ message: 'Question:' });
      if (!question.trim()) {
        console.log(chalk.red('No question provided.'));
        process.exit(1);
      }
    }

    const spinner = ora('Looking up job...').start();
    const job = await getJobByUrl(url!).catch(() => null);
    if (!job) {
      spinner.fail(`No job found for that URL. Run "jobreach add <url>" first.`);
      process.exit(1);
    }
    spinner.text = `Drafting answer for ${chalk.bold(job.title)} at ${chalk.bold(job.company)}...`;

    let answer: string;
    try {
      answer = await answerApplicationQuestion(job, question!);
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

    await copyMenu([{ label: 'Answer', text: answer }]);
  });
