import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ============================================================================
// Types
// ============================================================================

export interface ConnectResult {
  status: string;
  message?: string;
  noteSent?: boolean;
  url?: string;
}

export interface EmployeeReference {
  name: string;
  linkedinUrl: string;
  title?: string;
}

export interface PeopleSearchResult {
  url: string;
  rawText: string;
  references: EmployeeReference[];
  companyUrn?: string;
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
  section_errors?: Record<string, unknown>;
}

// ============================================================================
// Singleton Client
// ============================================================================

let clientPromise: Promise<Client> | null = null;

export async function getClient(): Promise<Client> {
  if (clientPromise) {
    return clientPromise;
  }

  clientPromise = (async () => {
    const transport = new StdioClientTransport({
      command: 'uv',
      args: ['tool', 'run', 'linkedin-scraper-mcp'],
    });

    const client = new Client({ name: 'jobreach', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);

    return client;
  })();

  return clientPromise;
}

export async function closeLinkedinMcp(): Promise<void> {
  if (!clientPromise) {
    return;
  }

  try {
    const client = await clientPromise;
    await client.close();
  } catch {
    // ignore
  }

  clientPromise = null;
}

// ============================================================================
// Helpers
// ============================================================================

export function extractLinkedinUsername(url: string): string | null {
  const match = url.match(/\/in\/([^/?#]+)/);
  return match ? match[1] : null;
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

// ============================================================================
// Public API
// ============================================================================

export async function connectWithPerson(linkedinUrl: string, note: string): Promise<ConnectResult> {
  const username = extractLinkedinUsername(linkedinUrl);

  if (!username) {
    return { status: 'invalid_url', message: `Could not parse a /in/<username> from "${linkedinUrl}"` };
  }

  const client = await getClient();

  const raw = await client.callTool({
    name: 'connect_with_person',
    arguments: {
      linkedin_username: username,
      note,
    },
  }) as McpToolResult;

  if (raw.isError) {
    const errText = (raw.content ?? []).map(b => b.text ?? '').join('');
    return { status: 'send_failed', message: errText || 'Tool returned an error' };
  }

  const parsed = parseToolResult(raw);

  return {
    status: typeof parsed.status === 'string' ? parsed.status : 'unknown',
    message: typeof parsed.message === 'string' ? parsed.message : undefined,
    noteSent: typeof parsed.note_sent === 'boolean' ? parsed.note_sent : undefined,
    url: typeof parsed.url === 'string' ? parsed.url : undefined,
  };
}

// ============================================================================
// People discovery (raw-text scrape + reference extraction)
// ============================================================================

// Person entries in raw text follow this pattern (one block per person):
//   <Name>
//   <blank>
//   <Nth> degree connection
//   · <Nth>
//   <Title>
//   <mutual-connection line — optional>
//   Connect | Follow
// We walk the lines, anchor on the "· Nth" degree marker, then take the line
// before it as the name and the line after as the title.
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
      if (!l) {
        continue;
      }
      if (/degree connection$/i.test(l)) {
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

function absolutizeLinkedinPath(path: string): string {
  const cleaned = path.split('?')[0].replace(/\/$/, '');

  if (cleaned.startsWith('http')) {
    return cleaned;
  }

  return `https://www.linkedin.com${cleaned}`;
}

function normalizeScrapeResult(raw: McpToolResult, sectionKey: string): PeopleSearchResult {
  if (raw.isError) {
    const errText = (raw.content ?? []).map(b => b.text ?? '').join('');
    throw new Error(`linkedin MCP error: ${errText || 'unknown'}`);
  }

  const parsed = parseToolResult(raw) as unknown as RawScrapeResult;

  const rawText = parsed.sections?.[sectionKey] ?? '';
  const refList = parsed.references?.[sectionKey] ?? [];

  const titles = parseTitlesFromRawText(rawText);

  let companyUrn: string | undefined;

  for (const ref of refList) {
    if (ref.kind === 'company_urn' && typeof ref.value === 'string') {
      companyUrn = ref.value;
      break;
    }
  }

  const seen = new Set<string>();
  const references: EmployeeReference[] = [];

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
    const refContext = typeof ref.context === 'string' ? ref.context.trim() : '';
    const titleFromText = name ? titles.get(name) : undefined;

    references.push({
      name,
      linkedinUrl: url,
      title: titleFromText || refContext || undefined,
    });
  }

  return {
    url: parsed.url ?? '',
    rawText,
    references,
    companyUrn,
  };
}

export async function getCompanyEmployees(companySlug: string, keywords?: string): Promise<PeopleSearchResult> {
  const client = await getClient();

  const args: Record<string, unknown> = { company_name: companySlug };

  if (keywords && keywords.trim()) {
    args.keywords = keywords.trim();
  }

  const raw = await client.callTool({
    name: 'get_company_employees',
    arguments: args,
  }) as McpToolResult;

  return normalizeScrapeResult(raw, 'employees');
}

export interface SearchPeopleOpts {
  location?: string;
  currentCompany?: string;
}

export async function searchPeople(keywords: string, opts: SearchPeopleOpts = {}): Promise<PeopleSearchResult> {
  const client = await getClient();

  const args: Record<string, unknown> = { keywords };

  if (opts.location) {
    args.location = opts.location;
  }

  if (opts.currentCompany) {
    args.current_company = opts.currentCompany;
  }

  const raw = await client.callTool({
    name: 'search_people',
    arguments: args,
  }) as McpToolResult;

  return normalizeScrapeResult(raw, 'search_results');
}

