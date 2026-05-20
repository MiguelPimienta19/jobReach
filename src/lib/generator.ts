import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { JobPosting, Contact } from '../types.js';
import { recordTokens } from './tokenLog.js';

interface ResultMessage {
  type: 'result';
  subtype: string;
  result?: string;
  errors?: string[];
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
const contextPath = join(__dirname, '../../context/me.md');
const contextExists = existsSync(contextPath);

if (!contextExists) {
  console.warn('\n⚠  context/me.md not found — using built-in fallback bio. Create context/me.md for better results.\n');
}

const contextFile = contextExists ? readFileSync(contextPath, 'utf-8') : '';

const MY_BACKGROUND = `You are helping with a job search. Write in first person as the applicant.

${contextFile || `The applicant is Miguel Pimienta, a senior CS + Data Science student at University of Oregon graduating June 2026. Projects: Steward (1st place CMU NexHacks, privacy AI), AgDash (production dashboard for Papé Group), TechPrep (AI interview coach, MLH award). Stack: TypeScript, React, Node.js, Supabase, Python.`}

Write in a genuine, confident voice. No filler phrases. No corporate-speak. Sound like a sharp student, not a resume bot.`;

// ============================================================================
// Internal Generator
// ============================================================================

function usageFrom(message: unknown): { input: number; output: number; cacheRead: number; cacheWrite: number } | null {
  if (!message || typeof message !== 'object') { return null; }
  const m = message as Record<string, unknown>;
  const inner = ((m.message as Record<string, unknown> | undefined)?.usage ?? m.usage) as Record<string, number> | undefined;
  if (!inner || typeof inner !== 'object') { return null; }
  return {
    input: (inner.input_tokens as number) ?? 0,
    output: (inner.output_tokens as number) ?? 0,
    cacheRead: (inner.cache_read_input_tokens as number) ?? 0,
    cacheWrite: (inner.cache_creation_input_tokens as number) ?? 0,
  };
}

async function generate(prompt: string, stepName = 'generate'): Promise<string> {
  let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0;

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
    if (message.type === 'assistant') {
      const usage = usageFrom(message);
      if (usage) {
        inputTokens += usage.input;
        outputTokens += usage.output;
        cacheRead += usage.cacheRead;
        cacheWrite += usage.cacheWrite;
      }
    } else if (message.type === 'result') {
      recordTokens(stepName, inputTokens, outputTokens, cacheRead, cacheWrite);
      const r = message as ResultMessage;

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
  return generate(`Write a cover letter for Miguel applying to ${job.title} at ${job.company}.

Output ONLY the cover letter text — no intro, no "Here's the cover letter:", no word count, no markdown headers, no "---" separators. Just the letter itself, ready to copy-paste.

Rules:
- Under 350 words
- Lead with something punchy and specific — not "I am writing to express my interest"
- Highlight the 1-2 most relevant projects from Miguel's background
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

const ROLE_CONTEXT: Record<Contact['roleType'], string> = {
  recruiter: "This is a recruiter or talent acquisition person. Keep it to one short paragraph. Name the specific role Miguel applied to. Make it effortless for them to act — they get a lot of these.",
  university_recruiter: "This is a university recruiter or early talent person. They specifically hire new grads — this is their whole job. Lead with Miguel graduating June 2026, mention the strongest project in one sentence, and make it very easy for them to respond. These people want to find good new grads, so be direct about that.",
  alumni: "This is a University of Oregon alum at the company. Open with the shared UO background (one short clause — not gushing). Mention Miguel applied for the specific role. Ask for a quick chat or, if they're open to it, a referral to the hiring team. Warm tone, not a sales pitch. They are NOT a recruiter — don't ask them to act on a req.",
  engineer: "This is an engineer/IC on or near the team behind the role. Goal is a referral. Lead with one specific, relevant project of Miguel's that maps to what they likely work on (pick from his background). Ask if they'd be open to referring him — make it easy to say yes. Do NOT pitch the company back to them. They get referral bonuses, so the ask is fine if it's specific and quick to act on.",
};

export async function generateConnectionNote(job: JobPosting, contact: Contact): Promise<string> {
  const note = await generate(`Write a LinkedIn CONNECTION REQUEST NOTE from Miguel to ${contact.name} (${contact.title} at ${contact.company}).

Output ONLY the note text — nothing else. Ready to paste.

Context: ${ROLE_CONTEXT[contact.roleType]}
Job applied for: ${job.title} at ${job.company}

Rules:
- HARD LIMIT: 280 characters total (LinkedIn caps at 300, stay under)
- One short paragraph, no line breaks
- Mention the specific role
- Natural and direct — not a cover letter
- Don't start with "Hi" as the literal first word`, 'connectionNote');

  return note.slice(0, 280);
}

// ============================================================================
// Q&A
// ============================================================================

export async function answerApplicationQuestion(job: JobPosting, question: string): Promise<string> {
  return generate(`Answer this application question for Miguel applying to ${job.title} at ${job.company}.

Output ONLY the answer — no intro, no "Here's my answer:", no meta-commentary. Just the response text, ready to paste.

Question: "${question}"

Job context:
${job.description}
${job.requirements ? `\nRequirements: ${job.requirements}` : ''}

Rules:
- Write in first person as Miguel
- Be specific — reference real projects or experiences from his background where relevant
- Genuine and reflective, not corporate
- 150–250 words unless the question clearly calls for something shorter
- Do NOT start with "I" — vary the opening`, 'qa');
}
