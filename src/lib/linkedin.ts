import chalk from 'chalk';
import ora from 'ora';
import { generateConnectionNote } from './generator.js';
import { connectWithPerson, closeLinkedinMcp } from './linkedinMcp.js';
import type { JobPosting, Contact } from '../types.js';

// ============================================================================
// Timing Utilities
// ============================================================================

// 8–12s randomized delay between LinkedIn writes so velocity doesn't look robotic.
// Exported so connect.ts's interactive loop can also pace itself.
export async function jitterBetweenSends(): Promise<void> {
  const delay = 8000 + Math.floor(Math.random() * 4000);
  const waitSpinner = ora(chalk.dim(`Waiting ${Math.round(delay / 1000)}s before next request...`)).start();

  try {
    await new Promise(r => setTimeout(r, delay));
  } finally {
    waitSpinner.stop();
  }
}

// ============================================================================
// Connection Requests
// ============================================================================

// Status values returned by linkedin-scraper-mcp's connect_with_person tool that
// indicate the request was successfully sent or already complete.
const SUCCESS_STATUSES = new Set(['connected', 'accepted', 'pending', 'already_connected']);

export interface SendResult {
  contact: Contact;
  success: boolean;
  status?: string;
  message?: string;
}

export async function sendConnections(job: JobPosting, contacts: Contact[]): Promise<SendResult[]> {
  console.log(chalk.bold.blue(`\n  Sending ${contacts.length} LinkedIn connection request${contacts.length !== 1 ? 's' : ''}...\n`));

  const results: SendResult[] = [];
  let attempted = false;

  try {
    for (const contact of contacts) {
      if (!contact.linkedinUrl) {
        continue;
      }

      if (attempted) {
        await jitterBetweenSends();
      }

      const spinner = ora(`${contact.name}...`).start();
      const note = contact.connectionNote || await generateConnectionNote(job, contact).catch(() => '');

      if (!note) {
        spinner.warn(`${contact.name} — skipped (no connection note)`);
        results.push({ contact, success: false, status: 'no_note' });
        continue;
      }

      attempted = true;
      spinner.text = `${contact.name} — sending...`;

      let outcome;
      try {
        outcome = await connectWithPerson(contact.linkedinUrl, note);
      } catch (e) {
        outcome = { status: 'send_failed', message: e instanceof Error ? e.message : String(e) };
      }

      const success = SUCCESS_STATUSES.has(outcome.status);

      if (success) {
        spinner.succeed(chalk.green(`${contact.name} — ${outcome.status}`));
      } else {
        spinner.fail(chalk.red(`${contact.name} — ${outcome.status}${outcome.message ? `: ${outcome.message}` : ''}`));
      }

      results.push({ contact, success, status: outcome.status, message: outcome.message });
    }
  } finally {
    // Tear down the MCP child process so the CLI can exit cleanly.
    await closeLinkedinMcp();
  }

  console.log();

  return results;
}
