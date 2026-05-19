import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Contact } from '../types.js';

export async function findPeopleAtCompany(company: string, jobTitle: string, onProgress?: (msg: string) => void): Promise<Contact[]> {
  const prompt = `Search LinkedIn to find people at "${company}" who are relevant to someone applying for a "${jobTitle}" role.

Use the LinkedIn search tools to find:
1. **Recruiters or University Recruiters** at ${company} — search for people with titles like "Recruiter", "Talent Acquisition", "University Recruiting"
2. **Hiring Managers or Engineering Managers** for teams related to "${jobTitle}" at ${company}
3. **Recent new grad hires** — people who joined ${company} in the last 1-2 years with junior/new grad titles

For each person found, get their: full name, current job title, and LinkedIn profile URL.

When done, output ONLY a JSON array — no preamble, no explanation:
[{ "name": "...", "title": "...", "linkedinUrl": "https://linkedin.com/in/...", "roleType": "recruiter|hiring_manager|new_grad_hire" }]`;

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
      maxTurns: 20,
      settingSources: [],
    },
  })) {
    if (message.type === 'system' && message.subtype === 'init') {
      const linkedinStatus = message.mcp_servers.find(s => s.name === 'linkedin');
      onProgress?.(`LinkedIn MCP: ${linkedinStatus?.status ?? 'connecting...'}`);
    } else if (message.type === 'assistant') {
      const textBlocks = message.message.content.filter((b: { type: string }) => b.type === 'text');
      if (textBlocks.length > 0) {
        const preview = (textBlocks[0] as { type: 'text'; text: string }).text.slice(0, 80).replace(/\n/g, ' ');
        if (preview.trim()) onProgress?.(preview);
      }
    } else if (message.type === 'result') {
      if (message.subtype === 'success') {
        const jsonMatch = message.result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as Array<{ name: string; title: string; linkedinUrl?: string | null; roleType: string }>;
            contacts = parsed.filter(p => p.name && p.title).map(p => ({ name: p.name, title: p.title, linkedinUrl: p.linkedinUrl ?? undefined, company, roleType: (p.roleType as Contact['roleType']) ?? 'other' }));
          } catch { /* malformed JSON */ }
        }
      } else {
        const errMsg = 'errors' in message ? (message.errors as string[]).join('; ') : String((message as { subtype: string }).subtype);
        onProgress?.(`Agent ended with: ${errMsg}`);
      }
    }
  }

  return contacts;
}
