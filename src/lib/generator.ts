import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { JobPosting, Contact, RoleType } from '../types.js';
import { anthropic, MODEL_WRITER, MODEL_FAST } from './anthropic.js';
import { loadProfile } from './profile.js';
import { findProjectRoot } from './projectRoot.js';

// ============================================================================
// Types
// ============================================================================

interface ParsedJobDetails {
  company?: string;
  title?: string;
  description?: string;
  location?: string;
  salaryRange?: string;
  requirements?: string;
}

// ============================================================================
// Context Loading (per-call scoping)
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path differs between dev (src/lib/) and built (dist/). Also handles the
// `npm install -g .` case where context/me.md (git-ignored) isn't in the
// install dir — walks up from CWD or honors JOBREACH_HOME. Uses context/me.md
// as the marker because context/ alone exists in the global install (it ships
// the .example.md files), but the user's real personalized files don't.
function findContextDir(): string {
  const fromProject = findProjectRoot(join('context', 'me.md'));

  if (fromProject) {
    return join(fromProject, 'context');
  }

  const fallbacks = [
    join(__dirname, '../context'),
    join(__dirname, '../../context'),
  ];

  for (const c of fallbacks) {
    if (existsSync(c)) {
      return c;
    }
  }

  return fallbacks[1];
}

function loadContextFile(filename: string): string {
  const path = join(findContextDir(), filename);

  if (!existsSync(path)) {
    return '';
  }

  return readFileSync(path, 'utf-8').trim();
}

const ME = loadContextFile('me.md');
const COVER_LETTER_RULES = loadContextFile('cover-letter.md');
const CONNECTION_NOTE_RULES = loadContextFile('connection-note.md');

if (!ME && !COVER_LETTER_RULES && !CONNECTION_NOTE_RULES) {
  console.warn('\n[jobreach] No context files found in context/ — using built-in generic fallback.\n            Copy context/*.example.md to context/*.md and edit to personalize.\n');
}

// ============================================================================
// System Prompts (scoped per call)
// ============================================================================

const GENERIC_BIO_FALLBACK = `The applicant has not yet configured their background. Write professional, generic content. Do not invent specific projects, employers, or experiences. Briefly note that the user should add details to context/me.md to get personalized generation.`;

const COVER_LETTER_SYSTEM = `You are helping with a job search. Write in first person as the applicant.

${ME || GENERIC_BIO_FALLBACK}

${COVER_LETTER_RULES}

Write in a genuine, confident voice. No filler phrases. No corporate-speak. Sound like a sharp candidate, not a resume bot.`;

// connection-note.md is self-contained per Phase 0 — does NOT load me.md.
// The voice rules and verbatim examples in the file carry tone calibration.
const CONNECTION_NOTE_SYSTEM = `You are writing LinkedIn connection request notes for a job applicant.

${CONNECTION_NOTE_RULES || GENERIC_BIO_FALLBACK}`;

const QA_SYSTEM = `You are helping with a job search. Write in first person as the applicant.

${ME || GENERIC_BIO_FALLBACK}

Write in a genuine, confident voice. No filler phrases. No corporate-speak.`;

const EXTRACT_SYSTEM = `You extract structured fields from raw job-posting text. Return only the JSON object the user asks for — no preamble, no markdown fences, no commentary. Omit fields that aren't in the source.`;

// ============================================================================
// Internal Generator
// ============================================================================

async function generate(systemPrompt: string, userPrompt: string, model: string = MODEL_WRITER, maxTokens: number = 2048): Promise<string> {
  const result = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = result.content[0];

  if (!block || block.type !== 'text') {
    return '';
  }

  return block.text.trim();
}

// ============================================================================
// Job Extraction
// ============================================================================

export async function extractJobDetails(rawText: string, url: string): Promise<Omit<JobPosting, 'id' | 'status' | 'coverLetter'>> {
  const userPrompt = `Extract structured job posting info from this text. Return ONLY a JSON object:
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
${rawText.slice(0, 4000)}`;

  const result = await generate(EXTRACT_SYSTEM, userPrompt, MODEL_FAST, 3072);

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

  const userPrompt = `Write a cover letter for ${profile.name} applying to ${job.title} at ${job.company}.

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
Requirements: ${job.requirements ?? 'Not listed'}`;

  return generate(COVER_LETTER_SYSTEM, userPrompt);
}

// ============================================================================
// Connection Notes (batched)
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

// One Sonnet call producing N notes — cheaper than N parallel calls (no
// system-prompt repeat) and the model deliberately varies hooks across
// recipients because it sees all N at once. Handles N=1 fine.
export async function generateConnectionNotesBatch(job: JobPosting, contacts: Contact[]): Promise<string[]> {
  if (contacts.length === 0) {
    return [];
  }

  const profile = loadProfile();

  const contactBlocks = contacts
    .map((c, i) => `Contact ${i + 1}:
  name: ${c.name}
  title: ${c.title} at ${c.company}
  context: ${roleContextFor(c.roleType)}`)
    .join('\n\n');

  const userPrompt = `Write LinkedIn CONNECTION REQUEST NOTES from ${profile.name}, one per contact below, all for the same job application: ${job.title} at ${job.company}.

${contactBlocks}

Output ONLY a JSON array of strings in the same order as the contacts, no preamble:
["note for contact 1", "note for contact 2", ...]

Rules per note:
- HARD LIMIT: 280 characters total per note
- One short paragraph, no line breaks
- Mention the specific role
- Natural and direct — not a cover letter
- Don't start with "Hi" as the literal first word
- Tailor each to the contact's role context above`;

  const raw = await generate(CONNECTION_NOTE_SYSTEM, userPrompt);

  const match = raw.match(/\[[\s\S]*\]/);

  if (!match) {
    return contacts.map(() => '');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return contacts.map(() => '');
  }

  if (!Array.isArray(parsed) || parsed.length !== contacts.length || !parsed.every(n => typeof n === 'string')) {
    return contacts.map(() => '');
  }

  return (parsed as string[]).map(n => n.slice(0, 280));
}

// ============================================================================
// Q&A
// ============================================================================

export async function answerApplicationQuestion(job: JobPosting, question: string): Promise<string> {
  const profile = loadProfile();

  const userPrompt = `Answer this application question for ${profile.name} applying to ${job.title} at ${job.company}.

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
- Do NOT start with "I" — vary the opening`;

  return generate(QA_SYSTEM, userPrompt);
}
