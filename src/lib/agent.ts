import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Contact, RoleType } from '../types.js';
import { recordTokens } from './tokenLog.js';
import { loadProfile } from './profile.js';
import { getCompanyEmployees, searchPeople, type EmployeeReference } from './linkedinMcp.js';

// ============================================================================
// Types
// ============================================================================

interface RankedPick {
  index: number;
  roleType: string;
}

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
  usage?: ResultUsage;
  total_cost_usd?: number;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_ROLE_TYPES = new Set<RoleType>(['recruiter', 'university_recruiter', 'alumni', 'engineer']);

const RECRUITER_RE = /\b(recruit(er|ing)?|talent|sourc(er|ing)|people\s*ops|hr\b|human resources|head of people|tech(nical)? sourcer|hiring)\b/i;
const UNI_RECRUITER_RE = /\b(university|campus|early[-\s]?career|early[-\s]?talent|new\s*grad(uate)?|intern(ship)?|student|college)\b/i;
const ENGINEER_RE = /\b(engineer|swe|developer|software|infrastructure|platform|backend|frontend|full[-\s]?stack|sre|reliability|ml|ai\b|research|scientist|architect|technical lead|tech lead|staff|principal|founding engineer)\b/i;

// ============================================================================
// Slug derivation
// ============================================================================

function slugifyCompany(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ============================================================================
// Candidate filtering
// ============================================================================

interface Candidate {
  name: string;
  title: string;
  linkedinUrl: string;
  bin: 'recruiter' | 'university_recruiter' | 'engineer' | 'other';
}

function binCandidate(title: string): Candidate['bin'] {
  if (UNI_RECRUITER_RE.test(title) && RECRUITER_RE.test(title)) {
    return 'university_recruiter';
  }

  if (RECRUITER_RE.test(title)) {
    return 'recruiter';
  }

  if (ENGINEER_RE.test(title)) {
    return 'engineer';
  }

  return 'other';
}

function toCandidates(refs: EmployeeReference[]): Candidate[] {
  const out: Candidate[] = [];

  for (const r of refs) {
    if (!r.name || !r.linkedinUrl) {
      continue;
    }

    const title = (r.title ?? '').trim();

    out.push({
      name: r.name,
      title,
      linkedinUrl: r.linkedinUrl,
      bin: binCandidate(title),
    });
  }

  return out;
}

function dedupeByUrl(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const c of candidates) {
    if (seen.has(c.linkedinUrl)) {
      continue;
    }

    seen.add(c.linkedinUrl);
    out.push(c);
  }

  return out;
}

function viableCount(candidates: Candidate[]): number {
  return candidates.filter(c => c.bin !== 'other').length;
}

// ============================================================================
// LLM ranking (single short call, minimal system prompt)
// ============================================================================

async function rankCandidates(candidates: Candidate[], company: string, jobTitle: string, profile: ReturnType<typeof loadProfile>): Promise<RankedPick[]> {
  if (candidates.length === 0) {
    return [];
  }

  const slate = candidates.map((c, i) => `${i}. ${c.name} — ${c.title || '(no title)'}`).join('\n');

  const candidateDescriptor = [profile.school, profile.gradMonth ? 'new grad' : null].filter(Boolean).join(' ');
  const descriptorClause = candidateDescriptor ? ` (a ${candidateDescriptor})` : '';

  const secondSlot = profile.school
    ? `2. A ${profile.school} alum or someone with that school in their title — roleType: "alumni".`
    : `2. A generalist recruiter, hiring partner, or head of people — roleType: "recruiter".`;

  const prompt = `Pick up to 3 people from this list at "${company}" most likely to help ${profile.name}${descriptorClause} get hired for a "${jobTitle}" role.

Candidates:
${slate}

Priority order:
1. Recruiting/talent/HR/people ops — roleType: "recruiter". University/campus/early-talent recruiters are highest priority — roleType: "university_recruiter".
${secondSlot}
3. An engineer/IC plausibly close to the role for a referral — roleType: "engineer".

Skip a slot if there is no reasonable match. Return 1–3 picks, never 0 if anyone on the list is plausible.

Output ONLY this JSON array, no preamble:
[{ "index": <number from list>, "roleType": "recruiter" | "university_recruiter" | "alumni" | "engineer" }]`;

  let picks: RankedPick[] = [];

  for await (const message of query({
    prompt,
    options: {
      systemPrompt: 'Pick the best people from a short candidate list. Output JSON only.',
      maxTurns: 1,
      allowedTools: [],
      permissionMode: 'dontAsk',
      settingSources: [],
    },
  })) {
    if (message.type !== 'result') {
      continue;
    }

    const r = message as ResultMessage;
    const u = r.usage ?? {};

    recordTokens(
      'linkedin rank',
      u.input_tokens ?? 0,
      u.output_tokens ?? 0,
      u.cache_read_input_tokens ?? 0,
      u.cache_creation_input_tokens ?? 0,
      r.total_cost_usd ?? 0,
    );

    if (r.subtype !== 'success' || !r.result) {
      break;
    }

    const match = r.result.match(/\[[\s\S]*\]/);

    if (!match) {
      break;
    }

    try {
      const parsed = JSON.parse(match[0]) as RankedPick[];
      picks = parsed.filter(p => typeof p.index === 'number' && typeof p.roleType === 'string').slice(0, 3);
    } catch {
      // malformed JSON — bail out, caller handles empty picks
    }
  }

  return picks;
}

// ============================================================================
// Public API
// ============================================================================

export async function findPeopleAtCompany(company: string, jobTitle: string, onProgress?: (msg: string) => void): Promise<Contact[]> {
  // Small random delay so we don't hit LinkedIn back-to-back after a Playwright scrape
  const delay = 3000 + Math.floor(Math.random() * 4000);
  onProgress?.(`Pausing ${Math.round(delay / 1000)}s before LinkedIn search...`);
  await new Promise(r => setTimeout(r, delay));

  const profile = loadProfile();
  const slug = slugifyCompany(company);

  onProgress?.(`Listing employees at ${slug}...`);

  let employees: EmployeeReference[] = [];
  let companyUrn: string | undefined;

  try {
    const result = await getCompanyEmployees(slug);
    employees = result.references;
    companyUrn = result.companyUrn;
    onProgress?.(`Found ${employees.length} employees on /people/`);
  } catch (e) {
    onProgress?.(`get_company_employees failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  let candidates = dedupeByUrl(toCandidates(employees));

  // If we found fewer than 3 viably-binned candidates, broaden with a search.
  // Prefer the URN-based currentCompany facet when we have it (plain names are
  // silently ignored by LinkedIn's filter, per the MCP docs).
  if (viableCount(candidates) < 3) {
    const searchQuery = profile.school && !candidates.some(c => c.title.includes(profile.school!))
      ? `${profile.school} ${company}`
      : `recruiter ${company}`;

    onProgress?.(`Broadening with search: "${searchQuery}"`);

    try {
      const searchResult = await searchPeople(searchQuery, companyUrn ? { currentCompany: companyUrn } : {});
      const merged = dedupeByUrl([...candidates, ...toCandidates(searchResult.references)]);
      candidates = merged;
      onProgress?.(`Pool now ${candidates.length} candidates`);
    } catch (e) {
      onProgress?.(`search_people failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  // Keep the slate small to keep the rank call cheap. Prioritize binned candidates,
  // then fill remaining slots with "other" entries (titles like "CS @ Northwestern"
  // for alumni discovery, etc.).
  const ranked = [
    ...candidates.filter(c => c.bin !== 'other'),
    ...candidates.filter(c => c.bin === 'other'),
  ].slice(0, 15);

  onProgress?.(`Ranking ${ranked.length} candidates with one LLM call`);

  const picks = await rankCandidates(ranked, company, jobTitle, profile);

  const contacts: Contact[] = [];

  for (const pick of picks) {
    const c = ranked[pick.index];

    if (!c) {
      continue;
    }

    const roleType: RoleType = VALID_ROLE_TYPES.has(pick.roleType as RoleType)
      ? (pick.roleType as RoleType)
      : 'recruiter';

    contacts.push({
      name: c.name,
      title: c.title || '(role not listed)',
      linkedinUrl: c.linkedinUrl,
      company,
      roleType,
    });
  }

  return contacts;
}
