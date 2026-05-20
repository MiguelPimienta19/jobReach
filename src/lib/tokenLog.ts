// ============================================================================
// Token Usage Tracker
// ============================================================================

interface TokenEntry {
  step: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const _entries: TokenEntry[] = [];

export function resetTokenLog(): void {
  _entries.length = 0;
}

export function recordTokens(step: string, input: number, output: number, cacheRead = 0, cacheWrite = 0): void {
  const existing = _entries.find(e => e.step === step);
  if (existing) {
    existing.input += input;
    existing.output += output;
    existing.cacheRead += cacheRead;
    existing.cacheWrite += cacheWrite;
  } else {
    _entries.push({ step, input, output, cacheRead, cacheWrite });
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
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );

  const fmt = (n: number) => n.toLocaleString().padStart(7);
  const rows = _entries.map(e => `  ${e.step.padEnd(24)} ${fmt(e.input)} in   ${fmt(e.output)} out   cached: ${fmt(e.cacheRead)}`);
  const divider = '  ' + '─'.repeat(66);
  const total = `  ${'TOTAL'.padEnd(24)} ${fmt(totals.input)} in   ${fmt(totals.output)} out   cached: ${fmt(totals.cacheRead)}`;

  return ['  Token usage this run:', divider, ...rows, divider, total].join('\n');
}
