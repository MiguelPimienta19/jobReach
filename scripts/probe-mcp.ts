// One-off probe: call get_company_employees against a real company slug and
// dump the parsed shape (references with titles) we'll be feeding into the LLM.
// Run: npx tsx scripts/probe-mcp.ts <slug> [keywords]
/// <reference types="node" />

import { getCompanyEmployees, closeLinkedinMcp } from '../src/lib/linkedinMcp.js';

async function main(): Promise<void> {
  const slug = process.argv[2] ?? 'anthropicresearch';
  const keywords = process.argv[3];

  console.error(`[probe] getCompanyEmployees(${slug}, ${keywords ?? 'none'})`);

  const result = await getCompanyEmployees(slug, keywords);

  console.log('url:', result.url);
  console.log('companyUrn:', result.companyUrn);
  console.log(`references: ${result.references.length}`);

  for (const r of result.references.slice(0, 15)) {
    console.log(`  - ${r.name.padEnd(28)}  ${r.title ?? '(no title)'}`);
    console.log(`    ${r.linkedinUrl}`);
  }

  await closeLinkedinMcp();
}

main().catch(e => {
  console.error('FAILED:', e);
  closeLinkedinMcp().finally(() => process.exit(1));
});
