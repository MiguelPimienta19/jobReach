import chalk from 'chalk';
import ora from 'ora';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { generateConnectionNote } from './generator.js';
import type { JobPosting, Contact } from '../types.js';

const LINKEDIN_MCP = { type: 'stdio' as const, command: 'uv', args: ['tool', 'run', 'linkedin-scraper-mcp'] };

// 8–12s randomized delay between LinkedIn writes so velocity doesn't look robotic.
// Exported so connect.ts's interactive loop can also pace itself.
export async function jitterBetweenSends(): Promise<void> {
  const delay = 8000 + Math.floor(Math.random() * 4000);
  const waitSpinner = ora(chalk.dim(`Waiting ${Math.round(delay / 1000)}s before next request...`)).start();
  try { await new Promise(r => setTimeout(r, delay)); } finally { waitSpinner.stop(); }
}

async function sendOneRequest(linkedinUrl: string, note: string, onProgress?: (msg: string) => void): Promise<boolean> {
  for await (const message of query({
    prompt: `Use connect_with_person to send a connection request to ${linkedinUrl} with this exact note: "${note}"`,
    options: { mcpServers: { linkedin: LINKEDIN_MCP }, allowDangerouslySkipPermissions: true, permissionMode: 'bypassPermissions', maxTurns: 5, settingSources: [] },
  })) {
    if (message.type === 'assistant') {
      const text = message.message.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
      if (text?.text.trim()) onProgress?.(text.text.slice(0, 80).replace(/\n/g, ' '));
    } else if (message.type === 'result') {
      return (message as { type: 'result'; subtype: string }).subtype === 'success';
    }
  }
  return false;
}

export interface SendResult { contact: Contact; success: boolean }

export async function sendConnections(job: JobPosting, contacts: Contact[]): Promise<SendResult[]> {
  console.log(chalk.bold.blue(`\n  Sending ${contacts.length} LinkedIn connection request${contacts.length !== 1 ? 's' : ''}...\n`));
  const results: SendResult[] = [];
  let attempted = false;
  for (const contact of contacts) {
    if (!contact.linkedinUrl) continue;
    if (attempted) await jitterBetweenSends();
    const spinner = ora(`${contact.name}...`).start();
    const note = contact.connectionNote || await generateConnectionNote(job, contact).catch(() => '');
    if (!note) { spinner.warn(`${contact.name} — skipped (no connection note)`); results.push({ contact, success: false }); continue; }
    attempted = true;
    spinner.text = `${contact.name} — sending...`;
    const ok = await sendOneRequest(contact.linkedinUrl, note, msg => { spinner.text = chalk.dim(msg); });
    ok ? spinner.succeed(chalk.green(`${contact.name} — request sent`)) : spinner.fail(chalk.red(`${contact.name} — failed`));
    results.push({ contact, success: ok });
  }
  console.log();
  return results;
}
