import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { scrapeJobPosting } from '../lib/scraper.js';
import { extractJobDetails, generateCoverLetter, generateOutreachMessage } from '../lib/generator.js';
import { findPeopleAtCompany } from '../lib/agent.js';
import { saveJob, saveContact, saveMessage, getJobByUrl } from '../lib/supabase.js';
import type { Contact, JobPosting } from '../types.js';

export const addCommand = new Command('add')
  .description('Add a job posting and generate outreach materials')
  .argument('<url>', 'URL of the job posting')
  .action(async (url: string) => {
    console.log(chalk.bold.blue('\n  jobreach  —  Personal Job Search Assistant\n'));

    // Deduplicate
    const dupSpinner = ora('Checking database...').start();
    const existing = await getJobByUrl(url).catch(() => null);
    if (existing) {
      dupSpinner.info(chalk.yellow(`Already tracked: ${chalk.bold(existing.title)} at ${chalk.bold(existing.company)}`));
      return;
    }
    dupSpinner.stop();

    // Scrape
    const scrapeSpinner = ora('Fetching job posting with Playwright...').start();
    let rawText!: string;
    try {
      rawText = await scrapeJobPosting(url);
      scrapeSpinner.succeed('Job posting fetched');
    } catch (e) {
      scrapeSpinner.fail(`Failed to fetch: ${e}`);
      process.exit(1);
    }

    // Extract structured data
    const extractSpinner = ora('Parsing job details...').start();
    let job!: Omit<JobPosting, 'id' | 'status' | 'coverLetter'>;
    try {
      job = await extractJobDetails(rawText, url);
      extractSpinner.succeed(`${chalk.bold(job.title)} at ${chalk.bold(job.company)}${job.location ? chalk.gray(` · ${job.location}`) : ''}`);
    } catch (e) {
      extractSpinner.fail(`Failed to parse job details: ${e}`);
      process.exit(1);
    }

    // Cover letter
    const coverSpinner = ora('Writing cover letter...').start();
    let coverLetter = '';
    try {
      coverLetter = await generateCoverLetter(job);
      coverSpinner.succeed('Cover letter written');
    } catch (e) {
      coverSpinner.warn(`Cover letter failed (continuing): ${e}`);
    }

    // Find contacts via agent loop
    const agentSpinner = ora('Running contact search agent...').start();
    let contacts: Contact[] = [];
    try {
      contacts = await findPeopleAtCompany(job.company, job.title, (msg) => { agentSpinner.text = chalk.dim(msg); });
      agentSpinner.succeed(`Found ${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`);
    } catch (e) {
      agentSpinner.warn(`Contact search issue (continuing): ${e}`);
    }

    // Outreach messages
    if (contacts.length > 0) {
      const msgSpinner = ora('Generating outreach messages...').start();
      for (const contact of contacts) {
        try {
          contact.outreachMessage = await generateOutreachMessage({ ...job, coverLetter, status: 'pending' }, contact);
        } catch {
          contact.outreachMessage = '';
        }
      }
      msgSpinner.succeed('Outreach messages ready');
    }

    // Persist
    const saveSpinner = ora('Saving to Supabase...').start();
    try {
      const jobId = await saveJob({ ...job, coverLetter, status: 'pending' });
      for (const contact of contacts) {
        const contactId = await saveContact({ ...contact, jobId });
        if (contact.outreachMessage) await saveMessage(contactId, jobId, contact.outreachMessage);
      }
      saveSpinner.succeed('Saved to Supabase');
    } catch (e) {
      saveSpinner.warn(`Supabase save failed (continuing): ${e}`);
    }

    printSummary(job, contacts, coverLetter);
  });

function printSummary(job: Omit<JobPosting, 'id' | 'status' | 'coverLetter'>, contacts: Contact[], coverLetter: string) {
  const W = 62;
  const line = '─'.repeat(W);
  const div = chalk.bold.green('  ' + line);

  console.log('\n' + div);
  console.log(chalk.bold.green(`  ${job.title} — ${job.company}`));
  if (job.location) console.log(chalk.gray(`  ${job.location}${job.salaryRange ? '  ·  ' + job.salaryRange : ''}`));
  console.log(div);

  // Cover letter
  if (coverLetter) {
    console.log('\n' + chalk.bold.white('  COVER LETTER'));
    console.log(chalk.dim('  ' + line));
    console.log(coverLetter.split('\n').map(l => '  ' + l).join('\n'));
  }

  // Contacts
  console.log('\n' + chalk.bold.white(`  OUTREACH  ${contacts.length === 0 ? chalk.yellow('(none found)') : chalk.green(`(${contacts.length} found)`)}`));
  console.log(chalk.dim('  ' + line));

  if (contacts.length === 0) {
    console.log(chalk.yellow("\n  Couldn't find specific people at this company."));
    console.log(chalk.gray("  LinkedIn blocks most automated discovery. You'll need to search manually this time."));
  } else {
    contacts.forEach((contact, i) => {
      const roleLabel = { recruiter: chalk.magenta('Recruiter'), hiring_manager: chalk.blue('Hiring Manager'), new_grad_hire: chalk.green('New Grad Hire'), other: chalk.gray('Other') }[contact.roleType];
      console.log(`\n  ${chalk.bold(`${i + 1}. ${contact.name}`)}  ·  ${contact.title}  [${roleLabel}]`);
      if (contact.linkedinUrl) {
        console.log(`     ${chalk.cyan.underline(contact.linkedinUrl)}`);
      } else {
        console.log(`     ${chalk.dim('No LinkedIn URL found')}`);
      }
      if (contact.outreachMessage) {
        console.log();
        const msgLines = contact.outreachMessage.split('\n');
        const innerW = W - 6;
        console.log('     ' + chalk.dim('┌' + '─'.repeat(innerW) + '┐'));
        for (const raw of msgLines) {
          const words = raw.split(' ');
          const wrapped: string[] = [];
          let current = '';
          for (const word of words) {
            if ((current + ' ' + word).trim().length > innerW - 2) { wrapped.push(current.trim()); current = word; }
            else current = (current + ' ' + word).trim();
          }
          if (current) wrapped.push(current);
          for (const wl of wrapped) console.log('     ' + chalk.dim('│') + ' ' + chalk.white(wl.padEnd(innerW - 2)) + ' ' + chalk.dim('│'));
        }
        console.log('     ' + chalk.dim('└' + '─'.repeat(innerW) + '┘'));
      }
    });
  }

  console.log('\n' + div);
  console.log(chalk.bold.green('  Saved to Supabase. Good luck.'));
  console.log(div + '\n');
}
