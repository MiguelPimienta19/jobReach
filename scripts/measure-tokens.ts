// Measures token usage across every generator path with canned inputs.
// Run: npx tsx scripts/measure-tokens.ts
// No Supabase / LinkedIn / Playwright needed — just exercises the LLM calls.

import {
  extractJobDetails,
  generateCoverLetter,
  generateConnectionNotesBatch,
  answerApplicationQuestion,
} from '../src/lib/generator.js';
import { resetTokenLog, tokenSummary } from '../src/lib/tokenLog.js';
import type { Contact, JobPosting } from '../src/types.js';

const SAMPLE_JOB_TEXT = `
Software Engineer, Backend Platform
Acme Robotics, Remote (US)
$140k - $185k

About the role
Acme Robotics is building the operating system for industrial robots. We're hiring a backend engineer to own the data ingestion path — millions of telemetry events per minute from robots in the field, surfaced to operators and ML pipelines in seconds.

What you'll do
- Design and ship pieces of our streaming ingestion stack (Kafka, Redpanda, Postgres)
- Own the API surface that customer dashboards and internal ML training systems consume
- Pair with ML engineers to land features end-to-end

What we're looking for
- 2+ years of professional backend experience or strong project work
- Comfortable with Python or TypeScript at depth in at least one
- You've shipped something nontrivial — production traffic, real users
- Bonus: streaming systems, time-series databases, robotics or physical-world ops

Acme is a 40-person Series B company. Our team is small and senior; we operate with low ceremony.
`.trim();

async function main(): Promise<void> {
  resetTokenLog();

  console.log('\n[1/4] extractJobDetails — should use a TINY system prompt');
  const job = await extractJobDetails(SAMPLE_JOB_TEXT, 'https://example.com/jobs/backend-platform');
  console.log(`   → ${job.title} at ${job.company}`);

  const fullJob: JobPosting = { ...job, status: 'pending' };

  console.log('\n[2/4] generateCoverLetter — full voice system prompt');
  const letter = await generateCoverLetter(fullJob);
  console.log(`   → ${letter.length} chars`);

  const contacts: Contact[] = [
    { name: 'Jordan Lee', title: 'University Recruiter', company: job.company, roleType: 'university_recruiter', linkedinUrl: 'https://linkedin.com/in/jordan-lee' },
    { name: 'Sam Patel', title: 'Senior Backend Engineer', company: job.company, roleType: 'engineer', linkedinUrl: 'https://linkedin.com/in/sam-patel' },
    { name: 'Riley Kim', title: 'Talent Partner', company: job.company, roleType: 'recruiter', linkedinUrl: 'https://linkedin.com/in/riley-kim' },
  ];

  console.log('\n[3/4] generateConnectionNotesBatch — single call for 3 contacts');
  const notes = await generateConnectionNotesBatch(fullJob, contacts);
  notes.forEach((n, i) => console.log(`   → ${contacts[i].name}: ${n.length} chars`));

  console.log('\n[4/4] answerApplicationQuestion — full voice system prompt');
  const answer = await answerApplicationQuestion(fullJob, 'Tell us about a hard technical decision you owned.');
  console.log(`   → ${answer.length} chars`);

  console.log('\n' + tokenSummary());
  console.log();
}

main().catch(e => {
  console.error('FAILED:', e);
  console.log('\n' + tokenSummary());
  process.exit(1);
});
