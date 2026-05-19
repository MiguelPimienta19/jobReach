import { query } from '@anthropic-ai/claude-agent-sdk';
import type { JobPosting, Contact } from '../types.js';

const MY_BACKGROUND = `You are helping Miguel Pimienta with his job search. Write in first person as Miguel.

Miguel's background:
- Senior CS + Data Science student at University of Oregon, graduating June 2026
- Steward: 1st place CMU NexHacks — Chrome extension + Electron app for privacy-preserving AI (processes data locally, never sends to external servers)
- AgDash: Production React/TypeScript dashboard for Papé Group (major Pacific Northwest equipment dealer) — Python pipeline ingesting USDA agricultural data driving real business decisions
- TechPrep: AI-powered voice interview coach — MLH Best Use of Snowflake award
- Stack: TypeScript, React, Node.js, Supabase, Python. Strong full-stack + data engineering lean
- Every project listed is either in production or a competition winner

Write in a genuine, confident voice. No filler phrases. No corporate-speak. Sound like a sharp student, not a resume bot.`;

async function generate(prompt: string): Promise<string> {
  for await (const message of query({
    prompt,
    options: {
      systemPrompt: MY_BACKGROUND,
      maxTurns: 1,
      allowedTools: [],
      permissionMode: 'dontAsk',
      settingSources: [],
    },
  })) {
    if (message.type === 'result' && message.subtype === 'success') return message.result.trim();
  }
  return '';
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
  recruiter: "This is a recruiter or HR person. Keep it short — one tight paragraph. Mention the specific role Miguel applied to. Make it easy for them to act.",
  hiring_manager: "This is a hiring manager or engineering lead. Show genuine curiosity about the technical work their team does. Reference one specific project from Miguel's background that's most relevant. Ask a real question.",
  new_grad_hire: "This is a recent new grad hire at the company (joined 1-2 years ago). Make it peer-to-peer and casual. Ask about their experience as a new grad there — culture, what surprised them. Don't directly ask for a referral.",
  other: "Keep it professional and brief. One paragraph.",
};

export async function generateOutreachMessage(job: JobPosting, contact: Contact): Promise<string> {
  return generate(`Write a LinkedIn outreach message from Miguel to ${contact.name} (${contact.title} at ${contact.company}).

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
