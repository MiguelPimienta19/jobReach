import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { JobPosting, Contact } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contextPath = join(__dirname, '../../context/me.md');
const contextExists = existsSync(contextPath);
if (!contextExists) console.warn('\n⚠  context/me.md not found — using built-in fallback bio. Create context/me.md for better results.\n');
const contextFile = contextExists ? readFileSync(contextPath, 'utf-8') : '';

const MY_BACKGROUND = `You are helping with a job search. Write in first person as the applicant.

${contextFile || `The applicant is Miguel Pimienta, a senior CS + Data Science student at University of Oregon graduating June 2026. Projects: Steward (1st place CMU NexHacks, privacy AI), AgDash (production dashboard for Papé Group), TechPrep (AI interview coach, MLH award). Stack: TypeScript, React, Node.js, Supabase, Python.`}

Write in a genuine, confident voice. No filler phrases. No corporate-speak. Sound like a sharp student, not a resume bot.`;

async function generate(prompt: string): Promise<string> {
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
    if (message.type === 'result' && message.subtype === 'success') return message.result.trim();
    if (message.type === 'result' && message.subtype !== 'success') {
      const err = 'errors' in message ? (message.errors as string[]).join('; ') : message.subtype;
      throw new Error(`Generation agent failed: ${err}`);
    }
  }
  throw new Error('Generation agent completed without producing a result');
}

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
${rawText.slice(0, 8000)}`);

  const match = result.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse job details from page content');
  const parsed = JSON.parse(match[0]);
  return { url, company: parsed.company, title: parsed.title, description: parsed.description, location: parsed.location ?? undefined, salaryRange: parsed.salaryRange ?? undefined, requirements: parsed.requirements ?? undefined };
}

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
Requirements: ${job.requirements ?? 'Not listed'}`);
}

const ROLE_CONTEXT: Record<Contact['roleType'], string> = {
  recruiter: "This is a recruiter or talent acquisition person. Keep it to one short paragraph. Name the specific role Miguel applied to. Make it effortless for them to act — they get a lot of these.",
  university_recruiter: "This is a university recruiter or early talent person. They specifically hire new grads — this is their whole job. Lead with Miguel graduating June 2026, mention the strongest project in one sentence, and make it very easy for them to respond. These people want to find good new grads, so be direct about that.",
};

export async function generateOutreachMessage(job: JobPosting, contact: Contact): Promise<string> {
  return generate(`Write a LinkedIn outreach message from Miguel to ${contact.name} (${contact.title} at ${contact.company}).

Output ONLY the message text — no intro, no "Here's a message:", no word count, no "---". Just the message, ready to paste into LinkedIn.

Context: ${ROLE_CONTEXT[contact.roleType]}
Job applied for: ${job.title} at ${job.company}

Rules:
- Max 100 words
- No "I hope this message finds you well"
- No "I came across your profile"
- Natural and direct
- Don't start with "Hi" as the literal first word — vary the opening`);
}

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
- Do NOT start with "I" — vary the opening`);
}
