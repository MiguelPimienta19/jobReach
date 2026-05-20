import { Command } from 'commander';
import chalk from 'chalk';
import { listJobs } from '../lib/supabase.js';

// ============================================================================
// Constants
// ============================================================================

const STATUS_COLOR: Record<string, (s: string) => string> = {
  pending:   chalk.gray,
  applied:   chalk.blue,
  interview: chalk.cyan,
  offer:     chalk.green,
  rejected:  chalk.red,
};

// ============================================================================
// Command Definition
// ============================================================================

export const listCommand = new Command('list')
  .description('Show all tracked job applications, most recent first')
  .action(async () => {
    let jobs: Awaited<ReturnType<typeof listJobs>>;
    try {
      jobs = await listJobs();
    } catch (e) {
      console.error(chalk.red(`Failed to fetch jobs: ${e}`));
      process.exit(1);
    }

    if (jobs.length === 0) {
      console.log(chalk.yellow('\n  No jobs tracked yet. Run "jobreach add <url>" to get started.\n'));
      return;
    }

    console.log(chalk.bold.blue('\n  jobreach — tracked applications\n'));
    jobs.forEach((job, i) => {
      const status = STATUS_COLOR[job.status]?.(job.status) ?? chalk.gray(job.status);
      const date = new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.bold(job.company)} — ${job.title}  ${chalk.dim('·')}  ${status}  ${chalk.dim(date)}`);
    });
    console.log();
  });
