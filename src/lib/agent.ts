import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Contact } from '../types.js';

export async function findPeopleAtCompany(company: string, jobTitle: string, onProgress?: (msg: string) => void): Promise<Contact[]> {
  const prompt = `Research "${company}" and find contacts relevant to a "${jobTitle}" application.

Use WebSearch to find:
1. **Recruiters / University Recruiters** at ${company} — try searches like: "${company} recruiter site:linkedin.com", "${company} university recruiting"
2. **Hiring Managers / Engineering Managers** for roles similar to "${jobTitle}" — try: "${company} engineering manager ${jobTitle} site:linkedin.com"
3. **Recent new grad hires** at ${company} who joined in the last 1-2 years — try: "${company} new grad software engineer joined 2024 OR 2025", "${company}" "just joined" site:linkedin.com

Run multiple targeted searches. For each real person found, collect: name, title, LinkedIn URL (if available), and role category.

When done researching, output ONLY a JSON array — no preamble:
[{ "name": "...", "title": "...", "linkedinUrl": "..." or null, "roleType": "recruiter|hiring_manager|new_grad_hire" }]`;

  let contacts: Contact[] = [];

  for await (const message of query({
    prompt,
    options: {
      allowedTools: ['WebSearch'],
      permissionMode: 'dontAsk',
      maxTurns: 15,
      settingSources: [],
    },
  })) {
    if (message.type === 'system' && message.subtype === 'init') {
      onProgress?.(`Agent started (tools: ${message.tools.join(', ')})`);
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
          } catch { /* malformed JSON — return empty */ }
        }
      } else {
        const errMsg = 'errors' in message ? (message.errors as string[]).join('; ') : String((message as { subtype: string }).subtype);
        onProgress?.(`Agent ended with: ${errMsg}`);
      }
    }
  }

  return contacts;
}
