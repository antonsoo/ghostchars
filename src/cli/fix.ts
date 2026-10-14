import type { Finding, ScanOptions } from '../core/index.js';
import { reveal, sanitize } from '../core/index.js';
import { diagnosticText } from '../core/diagnosticText.js';
import { colors } from './colors.js';

export interface FixOutcome {
  path: string;
  fixed: Finding[];
  newText: string;
}

export function computeFix(path: string, source: string, options: ScanOptions = {}): FixOutcome {
  const { text, fixed } = sanitize(source, { mode: 'normalize', scanOptions: options });
  return { path, fixed, newText: text };
}

/** Renders a compact preview of what --fix would change, without writing anything. */
export function formatDryRun(outcome: FixOutcome, source: string): string {
  if (outcome.fixed.length === 0) return '';
  const lines: string[] = [colors.underline(diagnosticText(outcome.path))];
  const before = source.split(/\r\n|\r|\n/);
  const after = outcome.newText.split(/\r\n|\r|\n/);
  const emit = (lineNo: number, sign: '-' | '+', text: string) => {
    const marker = sign === '-' ? colors.red(sign) : colors.green(sign);
    lines.push(`  ${colors.gray(`${lineNo}:`)} ${marker} ${diagnosticText(reveal(text))}`);
  };
  // Render the actual proposed text, never replay diagnostic spans: findings
  // may overlap, include a retained base, or belong to a later sanitizer pass.
  if (before.length === after.length) {
    before.forEach((text, index) => {
      if (text === after[index]) return;
      emit(index + 1, '-', text);
      emit(index + 1, '+', after[index] ?? '');
    });
  } else {
    // Removing a character between CR and LF can join two line boundaries.
    // A linear common-prefix/suffix diff keeps even that preview exact without
    // a quadratic diff algorithm on large files.
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let tail = 0;
    while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    for (let i = start; i < before.length - tail; i++) emit(i + 1, '-', before[i] ?? '');
    for (let i = start; i < after.length - tail; i++) emit(i + 1, '+', after[i] ?? '');
  }
  lines.push(colors.dim(`  ${outcome.fixed.length} finding(s) affected. Preview only; no file was written.`));
  return lines.join('\n');
}
