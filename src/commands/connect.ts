import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { select, confirm } from '@inquirer/prompts';
import { listJobs, getContactsForJob, updateConnectionNote } from '../lib/supabase.js';
import { generateConnectionNotesBatch } from '../lib/generator.js';
import { sendConnections, jitterBetweenSends } from '../lib/linkedin.js';
import type { JobPosting, Contact } from '../types.js';

type ConnectionRoleType = 'recruiter' | 'university_recruiter';

// ============================================================================
// Command Definition
// ============================================================================

export const connectCommand = new Command('connect')
  .description('Send LinkedIn connection requests for a tracked job')
  .option('--yes', 'Skip confirmations and send all automatically')
  .option('--regen', 'Regenerate connection notes before sending')
  .action(async (opts: { yes?: boolean; regen?: boolean }) => {
    const jobs = await listJobs().catch(() => []);
    if (jobs.length === 0) {
      console.log(chalk.yellow('\n  No jobs tracked yet. Run "jobreach add <url>" first.\n'));
      process.exit(1);
    }

    const jobUrl = await select({
      message: 'Pick a job to send connections for:',
      choices: jobs.map(j => ({ name: `${j.company} — ${j.title}  (${j.status})`, value: j.url })),
    });
    const job = jobs.find(j => j.url === jobUrl)!;

    const fetchSpinner = ora('Fetching contacts...').start();
    const contacts = await getContactsForJob(job.id).catch(() => []);
    fetchSpinner.stop();

    const withUrls = contacts.filter(c => c.linkedinUrl);
    if (withUrls.length === 0) {
      console.log(chalk.yellow('\n  No contacts with LinkedIn URLs found for this job.\n'));
      process.exit(0);
    }

    // Regen notes if requested, then save them back
    if (opts.regen) {
      const regenSpinner = ora('Regenerating connection notes...').start();
      const jobPosting: JobPosting = {
        id: job.id,
        url: job.url,
        company: job.company,
        title: job.title,
        description: '',
        status: 'pending',
      };
      const contactObjs: Contact[] = withUrls.map(c => ({
        name: c.name,
        title: c.title,
        linkedinUrl: c.linkedinUrl,
        company: job.company,
        roleType: c.roleType as ConnectionRoleType,
      }));

      const notes = await generateConnectionNotesBatch(jobPosting, contactObjs).catch(() => [] as string[]);

      await Promise.all(withUrls.map(async (c, i) => {
        const note = notes[i] ?? '';
        if (note) {
          c.connectionNote = note;
          await updateConnectionNote(c.contactId, note).catch(() => {});
        }
      }));

      regenSpinner.succeed('Notes regenerated');
    }

    if (opts.yes) {
      const jobPosting: JobPosting = {
        id: job.id,
        url: job.url,
        company: job.company,
        title: job.title,
        description: '',
        status: 'pending',
      };
      const contactObjs: Contact[] = withUrls.map(c => ({
        name: c.name,
        title: c.title,
        linkedinUrl: c.linkedinUrl,
        company: job.company,
        roleType: c.roleType as ConnectionRoleType,
        connectionNote: c.connectionNote,
      }));
      await sendConnections(jobPosting, contactObjs);
      return;
    }

    console.log(chalk.bold.blue(`\n  ${withUrls.length} contact${withUrls.length !== 1 ? 's' : ''} for ${job.company} — ${job.title}\n`));

    let sentAny = false;
    for (const contact of withUrls) {
      const jobPosting: JobPosting = {
        id: job.id,
        url: job.url,
        company: job.company,
        title: job.title,
        description: '',
        status: 'pending',
      };
      const contactObj: Contact = {
        name: contact.name,
        title: contact.title,
        linkedinUrl: contact.linkedinUrl,
        company: job.company,
        roleType: contact.roleType as ConnectionRoleType,
        connectionNote: contact.connectionNote,
      };

      console.log(chalk.bold(`  ${contact.name}`) + chalk.dim(`  ·  ${contact.title}`));
      console.log(chalk.dim(`  ${contact.linkedinUrl}`));

      const note = contact.connectionNote ?? '';
      if (!note) {
        console.log(chalk.yellow('  No connection note saved — run with --regen to generate one.\n'));
        continue;
      }

      console.log(chalk.dim(`\n  Note (${note.length}/280 chars):`));
      console.log(`  ${chalk.white(note)}\n`);

      const proceed = await confirm({ message: `Send to ${contact.name}?`, default: true });
      if (!proceed) {
        console.log(chalk.dim('  Skipped.\n'));
        continue;
      }

      // Jitter between successful sends — sendConnections's internal jitter doesn't fire
      // here because we call it one-at-a-time per confirmation
      if (sentAny) {
        await jitterBetweenSends();
      }
      const [result] = await sendConnections(jobPosting, [contactObj]);
      if (result?.success) {
        sentAny = true;
      }
    }
  });
