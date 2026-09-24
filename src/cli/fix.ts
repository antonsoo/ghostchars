import type { Finding } from '../core/index.js';
import { reveal, sanitize } from '../core/index.js';
import { colors } from './colors.js';

export interface FixOutcome {
  path: string;
  fixed: Finding[];
  newText: string;
}

export function computeFix(path: string, source: string): FixOutcome {
  const { text, fixed } = sanitize(source);
  return { path, fixed, newText: text };
}

/** Renders a compact preview of what --fix would change, without writing anything. */
export function formatDryRun(outcome: FixOutcome, source: string): string {
  if (outcome.fixed.length === 0) return '';
  const lines: string[] = [colors.underline(outcome.path)];
  const sourceLines = source.split(/\r\n|\r|\n/);
  const byLine = new Map<number, Finding[]>();
  for (const f of outcome.fixed) {
    if (!byLine.has(f.start.line)) byLine.set(f.start.line, []);
    byLine.get(f.start.line)!.push(f);
  }
  for (const [lineNo, findings] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const original = sourceLines[lineNo - 1] ?? '';
    let cleaned = original;
    // Remove in reverse column order so earlier offsets stay valid.
    for (const f of [...findings].sort((a, b) => b.start.column - a.start.column)) {
      cleaned = cleaned.slice(0, f.start.column - 1) + cleaned.slice(f.end.column - 1);
    }
    lines.push(`  ${colors.gray(`${lineNo}:`)} ${colors.red('-')} ${reveal(original)}`);
    lines.push(`  ${colors.gray(`${lineNo}:`)} ${colors.green('+')} ${cleaned}`);
  }
  lines.push(colors.dim(`  ${outcome.fixed.length} finding(s) would be fixed.`));
  return lines.join('\n');
}
