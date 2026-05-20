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

const VALID_ROLE_TYPES = new Set<RoleType>(['recruiter', 'university_recruiter', 'alumni', 'engineer']);

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

  const prompt = `Find exactly 3 people at "${company}" to help Miguel (a University of Oregon new grad) land a "${jobTitle}" role. Use only the search_people tool. Do exactly three searches, one per turn, then output the JSON.

Turn 1 — search_people with query "University Recruiter ${company}" (also accept "Campus Recruiter", "Early Career", "Early Talent", "New Grad Recruiting"). Pick the single best match. roleType: "university_recruiter".

Turn 2 — search_people with query "University of Oregon ${company}". Pick one UO alum at the company in any role. If — and only if — there are no plausible UO alumni matches, instead search "Recruiter ${company}" (also accept "Talent Acquisition") and pick one generalist recruiter; set roleType to "recruiter". Otherwise roleType: "alumni".

Turn 3 — search_people with a query matching the role behind "${jobTitle}" (e.g., "Software Engineer ${company}", "Product Manager ${company}", etc — match the actual title). Pick one current engineer/IC on the team or an adjacent team for a potential referral. Avoid recruiters and managers — we want a working IC. roleType: "engineer".

Rules:
- Exactly 1 person per slot. Do not return multiples of the same type.
- If a slot truly has no good match, skip it — better to return 2 than to pad with a bad match.
- No re-searches, no extra calls beyond the three above.

Output ONLY this JSON array as the final message, no preamble:
[{ "name": "...", "title": "...", "linkedinUrl": "https://linkedin.com/in/...", "roleType": "university_recruiter" | "alumni" | "recruiter" | "engineer" }]`;

  let contacts: Contact[] = [];
  let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0;

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
      allowedTools: ['mcp__linkedin__search_people'],
      maxTurns: 3,
      settingSources: [],
    },
  })) {
    if (message.type === 'system' && message.subtype === 'init') {
      const linkedinStatus = message.mcp_servers.find(s => s.name === 'linkedin');
      onProgress?.(`LinkedIn MCP: ${linkedinStatus?.status ?? 'connecting'}`);

    } else if (message.type === 'assistant') {
      const usage = usageFrom(message);
      if (usage) {
        inputTokens += usage.input;
        outputTokens += usage.output;
        cacheRead += usage.cacheRead;
        cacheWrite += usage.cacheWrite;
      }

      const textBlocks = message.message.content.filter((b: AgentContentBlock) => b.type === 'text');

      if (textBlocks.length > 0) {
        const preview = (textBlocks[0] as AgentTextBlock).text.slice(0, 80).replace(/\n/g, ' ');

        if (preview.trim()) {
          onProgress?.(preview);
        }
      }

    } else if (message.type === 'result') {
      recordTokens('linkedin search', inputTokens, outputTokens, cacheRead, cacheWrite);

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
