import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Contact, RoleType } from '../types.js';
import { recordTokens } from './tokenLog.js';

interface AgentContentBlock {
  type: string;
}

interface AgentTextBlock {
  type: 'text';
  text: string;
}

interface RawContactResult {
  name: string;
  title: string;
  linkedinUrl?: string | null;
  roleType: string;
}

interface ResultMessage {
  subtype: string;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_ROLE_TYPES = new Set<RoleType>(['recruiter', 'university_recruiter']);

// ============================================================================
// Helpers
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

// ============================================================================
// LinkedIn Contact Discovery
// ============================================================================

export async function findPeopleAtCompany(company: string, jobTitle: string, onProgress?: (msg: string) => void): Promise<Contact[]> {
  // Small random delay before hitting LinkedIn — avoid back-to-back velocity after Playwright scrape
  const delay = 3000 + Math.floor(Math.random() * 4000);
  onProgress?.(`Pausing ${Math.round(delay / 1000)}s before LinkedIn search...`);
  await new Promise(r => setTimeout(r, delay));

  const prompt = `Search LinkedIn to find up to 3 people at "${company}" who can directly help someone get hired for a "${jobTitle}" role.

Only look for these two types — no one else:
1. **Recruiters / Talent Acquisition** — people with titles like "Recruiter", "Talent Acquisition", "Staffing"
2. **University Recruiters / Early Talent** — people with titles like "University Recruiter", "Campus Recruiter", "Early Career", "Early Talent", "University Relations", "New Grad Recruiting"

University recruiters are the highest priority — they exist specifically to hire new grads.

Use get_company_employees for "${company}" first. If that doesn't give you enough, use search_people with targeted queries.

Return AT MOST 3 people. Quality over quantity — only include people whose title clearly matches the above.

Output ONLY a JSON array, no preamble:
[{ "name": "...", "title": "...", "linkedinUrl": "https://linkedin.com/in/...", "roleType": "recruiter" or "university_recruiter" }]`;

  let contacts: Contact[] = [];

  for await (const message of query({
    prompt,
    options: {
      mcpServers: {
        linkedin: {
          type: 'stdio',
          command: 'uv',
          args: ['tool', 'run', 'linkedin-scraper-mcp'],
        },
      },
      allowDangerouslySkipPermissions: true,
      permissionMode: 'bypassPermissions',
      maxTurns: 10,
      settingSources: [],
    },
  })) {
    if (message.type === 'system' && message.subtype === 'init') {
      const linkedinStatus = message.mcp_servers.find(s => s.name === 'linkedin');
      onProgress?.(`LinkedIn MCP: ${linkedinStatus?.status ?? 'connecting'}`);

    } else if (message.type === 'assistant') {
      const textBlocks = message.message.content.filter((b: AgentContentBlock) => b.type === 'text');

      if (textBlocks.length > 0) {
        const preview = (textBlocks[0] as AgentTextBlock).text.slice(0, 80).replace(/\n/g, ' ');

        if (preview.trim()) {
          onProgress?.(preview);
        }
      }

    } else if (message.type === 'result') {
      if (message.subtype === 'success') {
        const jsonMatch = message.result.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as RawContactResult[];

            contacts = parsed
              .filter(p => p.name && p.title)
              .slice(0, 3)
              .map(p => ({
                name: p.name,
                title: p.title,
                linkedinUrl: p.linkedinUrl ?? undefined,
                company,
                roleType: VALID_ROLE_TYPES.has(p.roleType as RoleType) ? (p.roleType as RoleType) : 'recruiter',
              }));
          } catch { /* malformed JSON */ }
        }
      } else {
        const errMsg = 'errors' in message ? (message.errors as string[]).join('; ') : String((message as ResultMessage).subtype);
        onProgress?.(`Agent ended with: ${errMsg}`);
      }
    }
  }

  return contacts;
}
