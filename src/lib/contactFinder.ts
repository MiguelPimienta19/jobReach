import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { input } from '@inquirer/prompts';
import type { Contact, JobPosting, RoleType } from '../types.js';
import { loadProfile } from './profile.js';
import type { UserProfile } from './profile.js';
import { findProjectRoot } from './projectRoot.js';
import './env.js';

// ============================================================================
// Types
// ============================================================================

export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
}

export interface ParsedCandidate {
  name: string;
  title: string;
  company: string;
  linkedinUrl: string;
}

interface SerperResponse {
  organic?: unknown[];
}

interface QuerySpec {
  query: string;
  bucket: RoleType;
}

interface RankedCandidate {
  candidate: ParsedCandidate;
  roleType: RoleType;
}

// ============================================================================
// Regex heuristics (ported from the old LinkedIn agent's system prompt)
// ============================================================================

const RECRUITER_RE = /recruit|talent|sourc(er|ing)|people ops|human resources|\bHR\b|staffing/i;
const UNIVERSITY_RE = /universit|campus|early career|new grad|emerging talent|intern program/i;
const ENGINEER_RE = /engineer|developer|\bSWE\b|software|platform|infrastructure/i;
const FORMER_RE = /\b(former|ex-|previously at|past:)\b/i;

const SERPER_ENDPOINT = 'https://google.serper.dev/search';

const RANK_PRIORITY: RoleType[] = ['university_recruiter', 'alumni', 'recruiter', 'engineer'];

// ============================================================================
// Pure helpers
// ============================================================================

function normalizeCompany(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Strip query string and trailing slash — same normalization as the old
// agent's absolutizeLinkedinPath, minus the host-prefixing (Google links are
// already absolute).
function normalizeLinkedinUrl(url: string): string {
  return url.split('?')[0].replace(/\/$/, '');
}

// ============================================================================
// parseResult
// ============================================================================

export function parseResult(result: SerperOrganicResult): ParsedCandidate | null {
  if (!result.link || !result.link.includes('linkedin.com/in')) {
    return null;
  }

  const linkedinUrl = normalizeLinkedinUrl(result.link);

  // Stage 1: parse the title string, e.g. "<Name> - <Title> - <Company> | LinkedIn".
  const stripped = result.title.replace(/\s*[|\-–]\s*LinkedIn\s*$/i, '').trim();
  const segments = stripped.split(' - ').map(s => s.trim()).filter(s => s.length > 0);

  let name = segments[0] ?? '';
  let title = '';
  let company = '';

  if (segments.length >= 3) {
    company = segments[segments.length - 1];
    title = segments.slice(1, -1).join(' - ');
  } else if (segments.length === 2) {
    title = segments[1];
    company = '';
  }

  // Stage 2: recover title/company from the snippet when the title string was
  // a single segment (or otherwise gave us nothing).
  if (!title) {
    const snippetMatch = result.snippet.match(/(?:^|\.\s)([A-Z][^.]{2,60}?)\s+at\s+([A-Z][\w&.,' -]{1,50})/);

    if (snippetMatch) {
      title = snippetMatch[1].trim();

      if (!company) {
        company = snippetMatch[2].trim();
      }
    }
  }

  if (!title) {
    return null;
  }

  return {
    name,
    title,
    company,
    linkedinUrl,
  };
}

// ============================================================================
// classifyTitle
// ============================================================================

export function classifyTitle(title: string, presumedBucket: RoleType, profile: UserProfile): RoleType | null {
  void profile;

  const isRecruiter = RECRUITER_RE.test(title);
  const isUniversity = UNIVERSITY_RE.test(title);
  const isEngineer = ENGINEER_RE.test(title);

  if (presumedBucket === 'alumni') {
    if (isUniversity) {
      return 'university_recruiter';
    }

    if (isRecruiter) {
      return 'recruiter';
    }

    return 'alumni';
  }

  if (presumedBucket === 'recruiter') {
    if (isUniversity) {
      return 'university_recruiter';
    }

    if (isRecruiter) {
      return 'recruiter';
    }

    return null;
  }

  if (presumedBucket === 'university_recruiter') {
    if (isUniversity) {
      return 'university_recruiter';
    }

    if (isRecruiter) {
      return 'recruiter';
    }

    return null;
  }

  if (presumedBucket === 'engineer') {
    if (isEngineer && !isRecruiter && !isUniversity) {
      return 'engineer';
    }

    return null;
  }

  return null;
}

// ============================================================================
// isCurrentEmployee
// ============================================================================

export function isCurrentEmployee(candidate: ParsedCandidate, jobCompany: string, snippet: string): boolean {
  if (FORMER_RE.test(snippet) || FORMER_RE.test(candidate.title)) {
    return false;
  }

  const normJob = normalizeCompany(jobCompany);

  if (!normJob) {
    return false;
  }

  const normCompany = normalizeCompany(candidate.company);

  if (normCompany) {
    if (normCompany.includes(normJob) || normJob.includes(normCompany)) {
      return true;
    }

    return false;
  }

  const normSnippet = normalizeCompany(snippet);

  if (normSnippet.includes(normJob)) {
    return true;
  }

  return false;
}

// ============================================================================
// rankCandidates
// ============================================================================

export function rankCandidates(candidates: RankedCandidate[], max = 3): Contact[] {
  const buckets = new Map<RoleType, ParsedCandidate[]>();

  for (const rt of RANK_PRIORITY) {
    buckets.set(rt, []);
  }

  for (const entry of candidates) {
    const bucket = buckets.get(entry.roleType);

    if (bucket) {
      bucket.push(entry.candidate);
    }
  }

  const picked: RankedCandidate[] = [];

  // Pass 1: one from each non-empty bucket in priority order (diversity first).
  for (const rt of RANK_PRIORITY) {
    if (picked.length >= max) {
      break;
    }

    const bucket = buckets.get(rt) ?? [];

    if (bucket.length > 0) {
      const candidate = bucket.shift() as ParsedCandidate;
      picked.push({ candidate, roleType: rt });
    }
  }

  // Pass 2: fill remaining slots by bucket priority.
  let progressed = true;

  while (picked.length < max && progressed) {
    progressed = false;

    for (const rt of RANK_PRIORITY) {
      if (picked.length >= max) {
        break;
      }

      const bucket = buckets.get(rt) ?? [];

      if (bucket.length > 0) {
        const candidate = bucket.shift() as ParsedCandidate;
        picked.push({ candidate, roleType: rt });
        progressed = true;
      }
    }
  }

  return picked.map(entry => ({
    name: entry.candidate.name,
    title: entry.candidate.title,
    linkedinUrl: entry.candidate.linkedinUrl,
    company: entry.candidate.company,
    roleType: entry.roleType,
  }));
}

// ============================================================================
// Serper client
// ============================================================================

function coerceOrganic(raw: unknown[]): SerperOrganicResult[] {
  const out: SerperOrganicResult[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const rec = item as Record<string, unknown>;

    if (typeof rec.title !== 'string' || typeof rec.link !== 'string') {
      continue;
    }

    out.push({
      title: rec.title,
      link: rec.link,
      snippet: typeof rec.snippet === 'string' ? rec.snippet : '',
    });
  }

  return out;
}

async function serperSearch(query: string, key: string, onProgress?: (msg: string) => void): Promise<SerperOrganicResult[]> {
  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 10 }),
    });

    if (!res.ok) {
      onProgress?.(`Serper query failed (${res.status})`);
      return [];
    }

    const data = await res.json() as SerperResponse;
    const organic = Array.isArray(data.organic) ? data.organic : [];

    return coerceOrganic(organic);
  } catch (e) {
    onProgress?.(`Serper query error: ${e instanceof Error ? e.message : 'unknown error'}`);
    return [];
  }
}

// ============================================================================
// API key resolution
// ============================================================================

// Appends SERPER_API_KEY to an existing .env (or creates one) and mirrors it
// into process.env for the current run.
function persistSerperKey(value: string): void {
  const existingRoot = findProjectRoot('.env');

  if (existingRoot) {
    const envPath = join(existingRoot, '.env');
    const current = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
    const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    appendFileSync(envPath, `${prefix}SERPER_API_KEY=${value}\n`);
  } else {
    const root = findProjectRoot('package.json') ?? process.cwd();
    const envPath = join(root, '.env');
    writeFileSync(envPath, `SERPER_API_KEY=${value}\n`);
  }

  process.env.SERPER_API_KEY = value;
}

// Prompt at most once per process — a skip at startup must not re-prompt
// mid-pipeline while an ora spinner owns the terminal.
let keyPromptShown = false;

export async function ensureSerperKey(): Promise<string | null> {
  const fromEnv = process.env.SERPER_API_KEY;

  if (fromEnv) {
    return fromEnv;
  }

  if (keyPromptShown) {
    return null;
  }

  keyPromptShown = true;

  const answer = await input({ message: 'Serper API key (free at serper.dev, enter to skip):' });
  const trimmed = answer.trim();

  if (!trimmed) {
    return null;
  }

  persistSerperKey(trimmed);

  return trimmed;
}

// ============================================================================
// Discovery pipeline
// ============================================================================

function buildQueries(job: JobPosting, profile: UserProfile): QuerySpec[] {
  const queries: QuerySpec[] = [
    {
      query: `site:linkedin.com/in "recruiter" "${job.company}"`,
      bucket: 'recruiter',
    },
    {
      query: `site:linkedin.com/in ("university recruiter" OR "early career" OR "campus recruiter") "${job.company}"`,
      bucket: 'university_recruiter',
    },
  ];

  if (profile.school) {
    queries.push({
      query: `site:linkedin.com/in "${profile.school}" "${job.company}"`,
      bucket: 'alumni',
    });
  }

  return queries;
}

// Runs the parse → current-employee → classify pipeline over one query's
// results, appending fresh (deduped) survivors into `into`.
function collectSurvivors(results: SerperOrganicResult[], bucket: RoleType, job: JobPosting, profile: UserProfile, into: RankedCandidate[], seen: Set<string>): void {
  for (const result of results) {
    const candidate = parseResult(result);

    if (!candidate) {
      continue;
    }

    if (seen.has(candidate.linkedinUrl)) {
      continue;
    }

    if (!isCurrentEmployee(candidate, job.company, result.snippet)) {
      continue;
    }

    const roleType = classifyTitle(candidate.title, bucket, profile);

    if (!roleType) {
      continue;
    }

    seen.add(candidate.linkedinUrl);
    into.push({ candidate, roleType });
  }
}

// ============================================================================
// Public API — findContactsForJob (signature preserved from the old agent)
// ============================================================================

export async function findContactsForJob(job: JobPosting, onProgress?: (msg: string) => void): Promise<Contact[]> {
  const key = await ensureSerperKey();

  if (!key) {
    onProgress?.('No SERPER_API_KEY — skipping contact discovery');
    return [];
  }

  const profile = loadProfile();
  const queries = buildQueries(job, profile);

  onProgress?.(`Searching Google for contacts at ${job.company}...`);

  const waves = await Promise.all(queries.map(async spec => {
    const results = await serperSearch(spec.query, key, onProgress);
    return { spec, results };
  }));

  const survivors: RankedCandidate[] = [];
  const seen = new Set<string>();

  for (const wave of waves) {
    collectSurvivors(wave.results, wave.spec.bucket, job, profile, survivors, seen);
  }

  onProgress?.(`${survivors.length} candidate(s) found`);

  // Backfill wave: broaden with an engineer search when the first pass is thin.
  if (survivors.length < 3) {
    onProgress?.('Backfilling with an engineer search...');

    const backfill = await serperSearch(`site:linkedin.com/in "software engineer" "${job.company}"`, key, onProgress);
    collectSurvivors(backfill, 'engineer', job, profile, survivors, seen);
  }

  const ranked = rankCandidates(survivors, 3);

  // Match the old agent's behavior: always stamp the job's company onto each
  // contact so downstream note generation stays consistent.
  for (const contact of ranked) {
    contact.company = job.company;
  }

  return ranked;
}
