import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { scrapeJobPosting } from '../lib/scraper.js';
import { extractJobDetails, generateCoverLetter, generateConnectionNote } from '../lib/generator.js';
import { sendConnections } from '../lib/linkedin.js';
import { findPeopleAtCompany } from '../lib/agent.js';
import { saveJob, saveContact, getJobByUrl } from '../lib/supabase.js';
import { resetTokenLog, tokenSummary } from '../lib/tokenLog.js';
import type { Contact, JobPosting } from '../types.js';

// ============================================================================
// Action Handler
// ============================================================================

export const addCommand = new Command('add')
  .description('Add a job posting and generate a cover letter and connection notes')
  .argument('<url>', 'URL of the job posting')
  .option('--connect', 'Send LinkedIn connection requests automatically after saving')
  .action(async (url: string, opts: { connect?: boolean }) => {
    resetTokenLog();
    console.log(chalk.bold.blue('\n  jobreach  —  Personal Job Search Assistant\n'));

    // Deduplicate — let DB errors surface rather than silently skipping the check
    const dupSpinner = ora('Checking database...').start();
    let existing: Awaited<ReturnType<typeof getJobByUrl>> = null;
    try {
      existing = await getJobByUrl(url);
    } catch {
      dupSpinner.stop(); // Supabase not configured — proceed without dedup
    }
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

    // Cover letter + contact search in parallel
    const parallelSpinner = ora('Generating cover letter & searching LinkedIn...').start();
    let coverLetter = '';
    let contacts: Contact[] = [];
    try {
      [coverLetter, contacts] = await Promise.all([
        generateCoverLetter(job).catch(e => { parallelSpinner.text = chalk.dim(`Cover letter error: ${e}`); return ''; }),
        findPeopleAtCompany(job.company, job.title, msg => { parallelSpinner.text = chalk.dim(msg); }).catch(() => [] as Contact[]),
      ]);
      const summary = [coverLetter ? 'Cover letter ready' : null, `${contacts.length} contact${contacts.length !== 1 ? 's' : ''} found`].filter(Boolean).join(' · ');
      parallelSpinner.succeed(summary);
    } catch (e) {
      parallelSpinner.warn(`Parallel step error (continuing): ${e}`);
    }

    // Generate connection notes in parallel
    if (contacts.length > 0) {
      const msgSpinner = ora('Generating connection notes...').start();
      await Promise.all(contacts.map(async contact => {
        const jobPosting = { ...job, coverLetter, status: 'pending' as const };
        const note = await generateConnectionNote(jobPosting, contact).catch(() => '');
        contact.connectionNote = note;
      }));
      msgSpinner.succeed('Connection notes ready');
    }

    // Persist
    const saveSpinner = ora('Saving to Supabase...').start();
    let saved = false;
    try {
      const jobId = await saveJob({ ...job, coverLetter, status: 'pending' });
      for (const contact of contacts) {
        await saveContact({ ...contact, jobId });
      }
      saveSpinner.succeed('Saved to Supabase');
      saved = true;
    } catch (e) {
      saveSpinner.warn(`Supabase save failed (continuing): ${e}`);
    }

    printSummary(job, contacts, coverLetter, saved);

    const tokenReport = tokenSummary();
    if (tokenReport) {
      console.log(chalk.dim(tokenReport));
      console.log();
    }

    if (opts.connect) {
      const withUrls = contacts.filter(c => c.linkedinUrl);
      if (withUrls.length > 0) {
        // Pause between LinkedIn scraping (just happened) and the first connection send,
        // so the back-to-back scrape→write doesn't look like a velocity spike to LinkedIn.
        const gapSpinner = ora(chalk.dim('Pausing 15s before sending requests...')).start();
        try {
          await new Promise(r => setTimeout(r, 15000));
        } finally {
          gapSpinner.stop();
        }

        const jobPosting = { ...job, coverLetter, status: 'pending' as const };
        await sendConnections(jobPosting, withUrls);
      }
    }
  });

// ============================================================================
// Render Helpers
// ============================================================================

function printSummary(job: Omit<JobPosting, 'id' | 'status' | 'coverLetter'>, contacts: Contact[], coverLetter: string, saved: boolean) {
  const W = 62;
  const line = '─'.repeat(W);
  const div = chalk.bold.green('  ' + line);

  console.log('\n' + div);
  console.log(chalk.bold.green(`  ${job.title} — ${job.company}`));
  if (job.location) {
    console.log(chalk.gray(`  ${job.location}${job.salaryRange ? '  ·  ' + job.salaryRange : ''}`));
  }
  console.log(div);

  // Cover letter
  if (coverLetter) {
    console.log('\n' + chalk.bold.white('  COVER LETTER'));
    console.log(chalk.dim('  ' + line));
    console.log(coverLetter.split('\n').map(l => '  ' + l).join('\n'));
  }

  // Contacts
  console.log('\n' + chalk.bold.white(`  CONTACTS  ${contacts.length === 0 ? chalk.yellow('(none found)') : chalk.green(`(${contacts.length} found)`)}`));
  console.log(chalk.dim('  ' + line));

  if (contacts.length === 0) {
    console.log(chalk.yellow("\n  Couldn't find specific people at this company."));
    console.log(chalk.gray("  LinkedIn blocks most automated discovery. You'll need to search manually this time."));
  } else {
    contacts.forEach((contact, i) => {
      const roleLabel = ({ recruiter: chalk.magenta('Recruiter'), university_recruiter: chalk.green('University Recruiter'), alumni: chalk.cyan('UO Alum'), engineer: chalk.yellow('Engineer (Referral)') }[contact.roleType]) ?? chalk.dim(contact.roleType);
      console.log(`\n  ${chalk.bold(`${i + 1}. ${contact.name}`)}  ·  ${contact.title}  [${roleLabel}]`);
      if (contact.linkedinUrl) {
        console.log(`     ${chalk.cyan.underline(contact.linkedinUrl)}`);
      } else {
        console.log(`     ${chalk.dim('No LinkedIn URL found')}`);
      }
      if (contact.connectionNote) {
        console.log(chalk.dim(`\n     Note (${contact.connectionNote.length}/280): `) + chalk.white(contact.connectionNote));
      }
    });
  }

  console.log('\n' + div);
  console.log(saved ? chalk.bold.green('  Saved to Supabase. Good luck.') : chalk.bold.yellow('  Not saved to Supabase — see warning above. Good luck.'));
  console.log(div + '\n');
}
