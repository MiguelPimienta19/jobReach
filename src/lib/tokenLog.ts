// ============================================================================
// Token Usage Tracker
// ============================================================================

interface TokenEntry {
  step: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

const _entries: TokenEntry[] = [];

export function resetTokenLog(): void {
  _entries.length = 0;
}

export function recordTokens(step: string, input: number, output: number, cacheRead = 0, cacheWrite = 0, costUsd = 0): void {
  const existing = _entries.find(e => e.step === step);
  if (existing) {
    existing.input += input;
    existing.output += output;
    existing.cacheRead += cacheRead;
    existing.cacheWrite += cacheWrite;
    existing.costUsd += costUsd;
  } else {
    _entries.push({ step, input, output, cacheRead, cacheWrite, costUsd });
  }
}

export function tokenSummary(): string {
  if (_entries.length === 0) {
    return '';
  }

  const totals = _entries.reduce(
    (acc, e) => ({
      input: acc.input + e.input,
      output: acc.output + e.output,
      cacheRead: acc.cacheRead + e.cacheRead,
      cacheWrite: acc.cacheWrite + e.cacheWrite,
      costUsd: acc.costUsd + e.costUsd,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
  );

  const fmt = (n: number) => n.toLocaleString().padStart(8);
  const fmtCost = (n: number) => ('$' + n.toFixed(4)).padStart(9);
  const header = `  ${'step'.padEnd(24)} ${'input'.padStart(8)}   ${'output'.padStart(8)}   ${'cWrite'.padStart(8)}   ${'cRead'.padStart(8)}   ${'cost'.padStart(9)}`;
  const rows = _entries.map(e => `  ${e.step.padEnd(24)} ${fmt(e.input)}   ${fmt(e.output)}   ${fmt(e.cacheWrite)}   ${fmt(e.cacheRead)}   ${fmtCost(e.costUsd)}`);
  const divider = '  ' + '─'.repeat(85);
  const total = `  ${'TOTAL'.padEnd(24)} ${fmt(totals.input)}   ${fmt(totals.output)}   ${fmt(totals.cacheWrite)}   ${fmt(totals.cacheRead)}   ${fmtCost(totals.costUsd)}`;

  const ratio = totals.cacheWrite + totals.cacheRead > 0
    ? `cache hit ratio: ${Math.round((totals.cacheRead / (totals.cacheRead + totals.cacheWrite)) * 100)}%`
    : 'cache hit ratio: n/a';

  return ['  Token usage this run:', divider, header, divider, ...rows, divider, total, divider, `  ${ratio}`].join('\n');
}
