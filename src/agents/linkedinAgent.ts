import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import type { Contact, JobPosting, RoleType } from '../types.js';
import { loadProfile } from '../lib/profile.js';

// ============================================================================
// Types
// ============================================================================

interface SlimEmployee {
  name: string;
  title: string;
  linkedinUrl: string;
}

interface McpContentBlock {
  type: string;
  text?: string;
}

interface McpToolResult {
  isError?: boolean;
  content?: McpContentBlock[];
}

interface RawReference {
  kind?: string;
  url?: string;
  text?: string;
  context?: string;
  value?: string;
}

interface RawScrapeResult {
  url?: string;
  sections?: Record<string, string>;
  references?: Record<string, RawReference[]>;
}

interface AgentResultMessage {
  type: 'result';
  subtype: string;
  result?: string;
}

interface AgentAssistantMessage {
  type: 'assistant';
  message?: { content?: { type: string; text?: string }[] };
}

interface RawContactOutput {
  name?: string;
  title?: string;
  linkedinUrl?: string;
  roleType?: string;
}

// ============================================================================
// Upstream MCP Client (lazy stdio)
// ============================================================================

let upstreamClient: Client | null = null;
let upstreamPromise: Promise<Client> | null = null;

async function getUpstream(): Promise<Client> {
  if (upstreamClient) {
    return upstreamClient;
  }

  if (upstreamPromise) {
    return upstreamPromise;
  }

  upstreamPromise = (async () => {
    const transport = new StdioClientTransport({
      command: 'uv',
      args: ['tool', 'run', 'linkedin-scraper-mcp'],
      stderr: process.env.JOBREACH_DEBUG_MCP ? 'inherit' : 'ignore',
    });

    const c = new Client({ name: 'jobreach', version: '1.0.0' }, { capabilities: {} });
    await c.connect(transport);
    upstreamClient = c;
    return c;
  })();

  return upstreamPromise;
}

export async function closeLinkedinAgent(): Promise<void> {
  if (!upstreamClient) {
    upstreamPromise = null;
    return;
  }

  try {
    await upstreamClient.close();
  } catch {
    // ignore — already closing or never opened
  }

  upstreamClient = null;
  upstreamPromise = null;
}

// ============================================================================
// Slim payload transform
// ============================================================================

function absolutizeLinkedinPath(path: string): string {
  const cleaned = path.split('?')[0].replace(/\/$/, '');

  if (cleaned.startsWith('http')) {
    return cleaned;
  }

  return `https://www.linkedin.com${cleaned}`;
}

// Person entries in raw text follow this pattern (one block per person):
//   <Name>
//   <blank>
//   <Nth> degree connection
//   · <Nth>
//   <Title>
//   <mutual-connection line — optional>
//   Connect | Follow
// Walks the lines, anchors on the "· Nth" marker, takes the line before as the
// name and the line after as the title.
function parseTitlesFromRawText(text: string): Map<string, string> {
  const lines = text.split('\n').map(l => l.trim());
  const titles = new Map<string, string>();

  for (let i = 1; i < lines.length - 1; i++) {
    if (!/^·\s+(1st|2nd|3rd|Out of network)$/i.test(lines[i])) {
      continue;
    }

    const title = lines[i + 1] ?? '';

    if (!title || /degree connection$/i.test(title) || /^(Connect|Follow)$/i.test(title)) {
      continue;
    }

    let name = '';

    for (let j = i - 1; j >= 0; j--) {
      const l = lines[j];

      if (!l || /degree connection$/i.test(l)) {
        continue;
      }

      name = l;
      break;
    }

    if (name && !titles.has(name)) {
      titles.set(name, title);
    }
  }

  return titles;
}

function parseToolResult(result: McpToolResult): Record<string, unknown> {
  const text = (result.content ?? [])
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('');

  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { raw: parsed };
  } catch {
    return { raw: text };
  }
}

function slimEmployees(raw: McpToolResult, sectionKey: string): SlimEmployee[] {
  if (raw.isError) {
    return [];
  }

  const parsed = parseToolResult(raw) as unknown as RawScrapeResult;
  const rawText = parsed.sections?.[sectionKey] ?? '';
  const refList = parsed.references?.[sectionKey] ?? [];
  const titles = parseTitlesFromRawText(rawText);

  const out: SlimEmployee[] = [];
  const seen = new Set<string>();

  for (const ref of refList) {
    if (ref.kind !== 'person' || typeof ref.url !== 'string') {
      continue;
    }

    const url = absolutizeLinkedinPath(ref.url);

    if (seen.has(url)) {
      continue;
    }

    seen.add(url);

    const name = (ref.text ?? '').trim();

    if (!name) {
      continue;
    }

    const refContext = typeof ref.context === 'string' ? ref.context.trim() : '';
    const titleFromText = titles.get(name);
    const title = titleFromText || refContext || '';

    out.push({
      name,
      title,
      linkedinUrl: url,
    });
  }

  return out;
}

// ============================================================================
// Slim SDK MCP server wrapping upstream linkedin-scraper-mcp
// ============================================================================

const getEmployeesTool = tool(
  'get_company_employees',
  'List employees at a company. Returns slim {name, title, linkedinUrl} entries only. Use a slugified company name (lowercase, no spaces/punctuation).',
  { companySlug: z.string(), keywords: z.string().optional() },
  async ({ companySlug, keywords }) => {
    const client = await getUpstream();
    const args: Record<string, unknown> = { company_name: companySlug };

    if (keywords && keywords.trim()) {
      args.keywords = keywords.trim();
    }

    const raw = await client.callTool({ name: 'get_company_employees', arguments: args }) as McpToolResult;
    const slim = slimEmployees(raw, 'employees');
    return { content: [{ type: 'text', text: JSON.stringify(slim) }] };
  },
);

const searchPeopleTool = tool(
  'search_people',
  'Broader LinkedIn people search. Use when get_company_employees yields fewer than 3 viable candidates. Returns slim {name, title, linkedinUrl} entries.',
  { keywords: z.string(), currentCompany: z.string().optional() },
  async ({ keywords, currentCompany }) => {
    const client = await getUpstream();
    const args: Record<string, unknown> = { keywords };

    if (currentCompany) {
      args.current_company = currentCompany;
    }

    const raw = await client.callTool({ name: 'search_people', arguments: args }) as McpToolResult;
    const slim = slimEmployees(raw, 'search_results');
    return { content: [{ type: 'text', text: JSON.stringify(slim) }] };
  },
);

const linkedinMcpServer = createSdkMcpServer({
  name: 'linkedin-slim',
  tools: [getEmployeesTool, searchPeopleTool],
});

// ============================================================================
// Agent driver
// ============================================================================

const VALID_ROLE_TYPES = new Set<RoleType>(['recruiter', 'university_recruiter', 'alumni', 'engineer']);

function slugifyCompany(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildSystemPrompt(profile: ReturnType<typeof loadProfile>, job: JobPosting): string {
  const candidateDescriptor = profile.gradMonth
    ? `a ${profile.school ?? ''} new grad (graduating ${profile.gradMonth})`.replace(/\s+/g, ' ').trim()
    : profile.school
      ? `a student/applicant from ${profile.school}`
      : 'an applicant';

  const schoolHeuristic = profile.school
    ? `- "${profile.school}"${profile.schoolShort ? ` or "${profile.schoolShort}"` : ''} anywhere in title → alumni`
    : '- (no school configured — alumni bin disabled; prefer recruiter/university_recruiter/engineer)';

  return `You are a contact-discovery agent for ${profile.name} (${candidateDescriptor}).

Goal: find up to 3 people at ${job.company} most likely to help with their application for "${job.title}".

Available MCP tools:
- get_company_employees(companySlug, keywords?) — slim list of employees at one company
- search_people(keywords, currentCompany?) — broader LinkedIn search

Heuristics (use these — do not reinvent them):
- "recruiter" / "talent" / "sourc(er|ing)" / "people ops" / "HR" → recruiter
- "university" / "campus" / "early career" / "new grad" / "intern" recruiter → university_recruiter (highest priority)
${schoolHeuristic}
- "engineer" / "developer" / "SWE" / "platform" / IC titles → engineer (lowest priority, only as referral path)

Workflow:
1. Call get_company_employees with the slugified company name "${slugifyCompany(job.company)}".
2. If you find fewer than 3 candidates matching the heuristics above, call search_people once to broaden — include the company name in keywords.
3. Never call tools more than 3 times total.
4. Pick up to 3 final contacts. Quality over quantity. Skip a slot if no reasonable match.

Output ONLY this JSON in your final message — no preamble, no code fences:
{"contacts":[{"name":"...","title":"...","linkedinUrl":"...","roleType":"recruiter|university_recruiter|alumni|engineer"}]}

Constraints:
- Maximum 3 contacts.
- Never invent LinkedIn URLs — use only URLs returned from the MCP tools.
- If MCP returns nothing useful, output {"contacts":[]}.`;
}

function extractFirstLine(msg: AgentAssistantMessage): string {
  const blocks = msg.message?.content ?? [];

  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') {
      const first = b.text.split('\n').find(l => l.trim());

      if (first) {
        return first.trim().slice(0, 120);
      }
    }
  }

  return '';
}

function parseContactsFromResult(result: string, job: JobPosting): Contact[] {
  const match = result.match(/\{[\s\S]*\}/);

  if (!match) {
    return [];
  }

  let parsed: { contacts?: RawContactOutput[] };

  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }

  const raw = Array.isArray(parsed.contacts) ? parsed.contacts : [];
  const out: Contact[] = [];

  for (const c of raw) {
    if (!c.name || !c.linkedinUrl) {
      continue;
    }

    const roleType: RoleType = VALID_ROLE_TYPES.has(c.roleType as RoleType)
      ? (c.roleType as RoleType)
      : 'recruiter';

    out.push({
      name: c.name,
      title: c.title || '(role not listed)',
      linkedinUrl: c.linkedinUrl,
      company: job.company,
      roleType,
    });
  }

  return out.slice(0, 3);
}

// ============================================================================
// Public API
// ============================================================================

export async function findContactsForJob(job: JobPosting, onProgress?: (msg: string) => void): Promise<Contact[]> {
  const profile = loadProfile();

  // Small random delay so we don't hit LinkedIn back-to-back after the Playwright scrape.
  const delay = 3000 + Math.floor(Math.random() * 4000);
  onProgress?.(`Pausing ${Math.round(delay / 1000)}s before LinkedIn search...`);
  await new Promise(r => setTimeout(r, delay));

  const systemPrompt = buildSystemPrompt(profile, job);
  const userPrompt = `Find contacts at ${job.company} for the "${job.title}" role.`;

  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt,
      model: 'claude-haiku-4-5',
      maxTurns: 5,
      mcpServers: { 'linkedin-slim': linkedinMcpServer },
      allowedTools: ['mcp__linkedin-slim__get_company_employees', 'mcp__linkedin-slim__search_people'],
      permissionMode: 'bypassPermissions',
      settingSources: [],
    },
  })) {
    if (message.type === 'assistant') {
      const line = extractFirstLine(message as AgentAssistantMessage);

      if (line) {
        onProgress?.(line);
      }
    }

    if (message.type === 'result') {
      const r = message as AgentResultMessage;

      if (r.subtype === 'success' && r.result) {
        return parseContactsFromResult(r.result, job);
      }

      onProgress?.(`agent returned non-success subtype "${r.subtype}"`);
      return [];
    }
  }

  return [];
}
