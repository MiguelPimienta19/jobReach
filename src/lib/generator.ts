import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { JobPosting, Contact, RoleType } from '../types.js';
import { recordTokens } from './tokenLog.js';
import { loadProfile } from './profile.js';

interface ResultUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ResultMessage {
  type: 'result';
  subtype: string;
  result?: string;
  errors?: string[];
  usage?: ResultUsage;
  total_cost_usd?: number;
}

interface ParsedJobDetails {
  company?: string;
  title?: string;
  description?: string;
  location?: string;
  salaryRange?: string;
  requirements?: string;
}

// ============================================================================
// Module Setup
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTEXT_FILES = ['me.md', 'resume.md', 'writing-samples.md', 'targets.md'];

// Path differs between dev (src/lib/) and built (dist/). Probe both so the
// globally-linked binary still finds context files.
function findContextDir(): string {
  const candidates = [
    join(__dirname, '../context'),
    join(__dirname, '../../context'),
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }

  return candidates[1];
}

function loadContext(): string {
  const base = findContextDir();

  return CONTEXT_FILES
    .filter(f => existsSync(join(base, f)))
    .map(f => readFileSync(join(base, f), 'utf-8'))
    .join('\n\n---\n\n');
}

const contextFile = loadContext();

if (!contextFile.trim()) {
  console.warn('\n[jobreach] No context files found in context/ — using built-in generic fallback bio.\n            Copy context/*.example.md to context/*.md and edit to personalize.\n');
}

// Single shared system prompt: extract acts as a cache pre-warmer for the
// writers below. We tried per-call slicing (me+writing-samples for the
// cover/notes path, me+resume for qa, minimal prompt for extract) and total
// per-run cost went UP, because the slices broke cache sharing across calls
// — see the comment block on the writer functions for the measured numbers.
const MY_BACKGROUND = `You are helping with a job search. Write in first person as the applicant.

${contextFile || `The applicant has not yet configured their background. Write professional, generic content. Do not invent specific projects, employers, or experiences. In the output, briefly note that the user should add details to context/me.md to get personalized generation.`}

Write in a genuine, confident voice. No filler phrases. No corporate-speak. Sound like a sharp candidate, not a resume bot.`;

// ============================================================================
// Internal Generator
// ============================================================================

async function generate(prompt: string, stepName = 'generate'): Promise<string> {
  for await (const message of query({
    prompt,
    options: {
      systemPrompt: MY_BACKGROUND,
      maxTurns: 1,
      // permissionMode: 'dontAsk' ensures no tools fire even if allowedTools: [] is ambiguous
      allowedTools: [],
      permissionMode: 'dontAsk',
      settingSources: [],
    },
  })) {
    if (message.type === 'result') {
      const r = message as ResultMessage;
      const u = r.usage ?? {};

      recordTokens(
        stepName,
        u.input_tokens ?? 0,
        u.output_tokens ?? 0,
        u.cache_read_input_tokens ?? 0,
        u.cache_creation_input_tokens ?? 0,
        r.total_cost_usd ?? 0,
      );

      if (r.subtype === 'success') {
        return (r.result ?? '').trim();
      }

      throw new Error(`Generation agent failed: ${r.errors?.join('; ') ?? r.subtype}`);
    }
  }

  throw new Error('Generation agent completed without producing a result');
}

// ============================================================================
// Job Extraction
// ============================================================================

// Uses the same MY_BACKGROUND system prompt as the writers (not a custom one).
// Empirically the SDK injects ~13K of base context per call regardless; sharing
// the voice prefix means call 1 pre-warms a cache that calls 2-4 read, instead
// of writing two separate cache prefixes.
//
// Measured tradeoff (May 2026, scripts/measure-tokens.ts with real context/*.md):
//   shared MY_BACKGROUND for all 4 calls .................. $0.2699
//   sliced (extract=minimal, cover=me+ws, qa=me+resume) ... $0.2901
// Slicing broke the cache that writers were reading from extract, so each
// writer paid its own cache-write cost. Keeping the shared prompt is cheaper.
export async function extractJobDetails(rawText: string, url: string): Promise<Omit<JobPosting, 'id' | 'status' | 'coverLetter'>> {
  const result = await generate(`Extract structured job posting info from this text. Return ONLY a JSON object:
{
  "company": "string",
  "title": "string",
  "description": "string (max 500 words, core of what the role does)",
  "location": "string or null",
  "salaryRange": "string or null",
  "requirements": "string (max 300 words, key skills and qualifications)"
}

Job URL: ${url}

Text:
${rawText.slice(0, 4000)}`, 'extract');

  const match = result.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error('Could not parse job details from page content');
  }

  let parsed: ParsedJobDetails;

  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('Model returned malformed JSON for job details — try re-running');
  }

  if (!parsed.company || !parsed.title || !parsed.description) {
    throw new Error('Model returned JSON missing required job fields (company, title, description)');
  }

  return {
    url,
    company: parsed.company,
    title: parsed.title,
    description: parsed.description,
    location: parsed.location ?? undefined,
    salaryRange: parsed.salaryRange ?? undefined,
    requirements: parsed.requirements ?? undefined,
  };
}

// ============================================================================
// Cover Letter
// ============================================================================

export async function generateCoverLetter(job: JobPosting): Promise<string> {
  const profile = loadProfile();

  return generate(`Write a cover letter for ${profile.name} applying to ${job.title} at ${job.company}.

Output ONLY the cover letter text — no intro, no "Here's the cover letter:", no word count, no markdown headers, no "---" separators. Just the letter itself, ready to copy-paste.

Rules:
- Under 350 words
- Lead with something punchy and specific — not "I am writing to express my interest"
- Highlight the 1-2 most relevant projects from ${profile.name}'s background
- Be specific about WHY this company/role, not generic enthusiasm
- End with confidence, not desperation

Role: ${job.title} at ${job.company}
${job.location ? `Location: ${job.location}` : ''}
Description: ${job.description}
Requirements: ${job.requirements ?? 'Not listed'}`, 'coverLetter');
}

// ============================================================================
// Connection Note Generation
// ============================================================================

function roleContextFor(roleType: RoleType): string {
  const profile = loadProfile();
  const gradClause = profile.gradMonth ? `Lead with ${profile.name} graduating ${profile.gradMonth}` : `Lead with what makes ${profile.name} a strong candidate`;
  const newGradFraming = profile.gradMonth
    ? `They specifically hire new grads — this is their whole job. ${gradClause}, mention the strongest project in one sentence, and make it very easy for them to respond. These people want to find good new grads, so be direct about that.`
    : `They run early-career and experienced-hire pipelines. ${gradClause}, mention the strongest project in one sentence, and make it very easy for them to respond. Be direct about the role and why ${profile.name} is a fit.`;

  const alumniContext = profile.school
    ? `This is a ${profile.school} alum at the company. Open with the shared ${profile.schoolShort ?? profile.school} background (one short clause — not gushing). Mention ${profile.name} applied for the specific role. Ask for a quick chat or, if they're open to it, a referral to the hiring team. Warm tone, not a sales pitch. They are NOT a recruiter — don't ask them to act on a req.`
    : `This is someone with a shared background at the company. Open with the shared thread (one short clause — not gushing). Mention ${profile.name} applied for the specific role. Ask for a quick chat or, if they're open to it, a referral to the hiring team. Warm tone, not a sales pitch.`;

  const map: Record<RoleType, string> = {
    recruiter: `This is a recruiter or talent acquisition person. Keep it to one short paragraph. Name the specific role ${profile.name} applied to. Make it effortless for them to act — they get a lot of these.`,
    university_recruiter: `This is a university recruiter or early talent person. ${newGradFraming}`,
    alumni: alumniContext,
    engineer: `This is an engineer/IC on or near the team behind the role. Goal is a referral. Lead with one specific, relevant project of ${profile.name}'s that maps to what they likely work on (pick from their background). Ask if they'd be open to referring them — make it easy to say yes. Do NOT pitch the company back to them. They get referral bonuses, so the ask is fine if it's specific and quick to act on.`,
  };

  return map[roleType];
}

export async function generateConnectionNote(job: JobPosting, contact: Contact): Promise<string> {
  const profile = loadProfile();

  const note = await generate(`Write a LinkedIn CONNECTION REQUEST NOTE from ${profile.name} to ${contact.name} (${contact.title} at ${contact.company}).

Output ONLY the note text — nothing else. Ready to paste.

Context: ${roleContextFor(contact.roleType)}
Job applied for: ${job.title} at ${job.company}

Rules:
- HARD LIMIT: 280 characters total (LinkedIn caps at 300, stay under)
- One short paragraph, no line breaks
- Mention the specific role
- Natural and direct — not a cover letter
- Don't start with "Hi" as the literal first word`, 'connectionNote');

  return note.slice(0, 280);
}

// Batched variant — writes a note for every contact in a single LLM call, so
// the voice system prompt is sent (and cached) once instead of N times.
export async function generateConnectionNotesBatch(job: JobPosting, contacts: Contact[]): Promise<string[]> {
  if (contacts.length === 0) {
    return [];
  }

  if (contacts.length === 1) {
    const note = await generateConnectionNote(job, contacts[0]);
    return [note];
  }

  const profile = loadProfile();

  const contactBlocks = contacts
    .map((c, i) => `Contact ${i + 1}:
  name: ${c.name}
  title: ${c.title} at ${c.company}
  context: ${roleContextFor(c.roleType)}`)
    .join('\n\n');

  const raw = await generate(`Write LinkedIn CONNECTION REQUEST NOTES from ${profile.name}, one per contact below, all for the same job application: ${job.title} at ${job.company}.

${contactBlocks}

Output ONLY a JSON array of strings in the same order as the contacts, no preamble:
["note for contact 1", "note for contact 2", ...]

Rules per note:
- HARD LIMIT: 280 characters total per note
- One short paragraph, no line breaks
- Mention the specific role
- Natural and direct — not a cover letter
- Don't start with "Hi" as the literal first word
- Tailor each to the contact's role context above`, 'connectionNotesBatch');

  const match = raw.match(/\[[\s\S]*\]/);

  if (!match) {
    // Fall back to per-contact calls if the batch response is malformed
    return Promise.all(contacts.map(c => generateConnectionNote(job, c)));
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return Promise.all(contacts.map(c => generateConnectionNote(job, c)));
  }

  if (!Array.isArray(parsed) || parsed.length !== contacts.length || !parsed.every(n => typeof n === 'string')) {
    return Promise.all(contacts.map(c => generateConnectionNote(job, c)));
  }

  return (parsed as string[]).map(n => n.slice(0, 280));
}

// ============================================================================
// Q&A
// ============================================================================

export async function answerApplicationQuestion(job: JobPosting, question: string): Promise<string> {
  const profile = loadProfile();

  return generate(`Answer this application question for ${profile.name} applying to ${job.title} at ${job.company}.

Output ONLY the answer — no intro, no "Here's my answer:", no meta-commentary. Just the response text, ready to paste.

Question: "${question}"

Job context:
${job.description}
${job.requirements ? `\nRequirements: ${job.requirements}` : ''}

Rules:
- Write in first person as ${profile.name}
- Be specific — reference real projects or experiences from their background where relevant
- Genuine and reflective, not corporate
- 150–250 words unless the question clearly calls for something shorter
- Do NOT start with "I" — vary the opening`, 'qa');
}
