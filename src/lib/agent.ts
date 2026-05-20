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

  const prompt = `Find up to 3 people at "${company}" who can help Miguel (a University of Oregon new grad) get hired for a "${jobTitle}" role.

Step 1 — call get_company_employees for "${company}" to see who's there. If that returns nothing useful, fall back to search_people.

Step 2 — from what you find, pick up to 3 people using this priority order:
1. Anyone in recruiting, HR, talent acquisition, or people ops — roleType: "recruiter". University/campus/early-talent recruiters are highest priority — roleType: "university_recruiter".
2. A University of Oregon alum (any role) — roleType: "alumni".
3. An engineer or IC in a role similar to "${jobTitle}" who could give a referral — roleType: "engineer".

For small companies with no dedicated recruiter, the hiring manager, a senior engineer, or even a founder is a valid pick — anyone who would plausibly see or pass along a resume.

Skip a slot if there is truly no reasonable match. Return 1–3 people, never 0 if anyone at the company is visible.

Output ONLY this JSON array as the final message, no preamble:
[{ "name": "...", "title": "...", "linkedinUrl": "https://linkedin.com/in/...", "roleType": "recruiter" | "university_recruiter" | "alumni" | "engineer" }]`;

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
      maxTurns: 8,
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
