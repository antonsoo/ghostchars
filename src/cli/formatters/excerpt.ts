import type { Finding } from '../../core/index.js';
import { diagnosticText } from '../../core/diagnosticText.js';

interface Part { text: string; start: number; end: number }

const lineBreak = (char: string | undefined): boolean => char === '\r' || char === '\n';
const lowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;
const highSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;

/** Walk only the displayed code points. The budget counts escaped output, not
 * input, and never cuts a surrogate pair or an escape label in half. */
function take(source: string, start: number, end: number, budget: number, reverse = false, stopAtLine = false): Part {
  const pieces: string[] = [];
  let cursor = reverse ? end : start;
  let used = 0;
  while (reverse ? cursor > start : cursor < end) {
    let next: number;
    if (reverse) {
      next = cursor - 1;
      if (next > start && lowSurrogate(source.charCodeAt(next)) && highSurrogate(source.charCodeAt(next - 1))) next--;
    } else next = cursor + (source.codePointAt(cursor)! > 0xffff ? 2 : 1);
    const char = source.slice(Math.min(cursor, next), Math.max(cursor, next));
    if (stopAtLine && lineBreak(char)) break;
    const visible = diagnosticText(char);
    if (used + visible.length > budget) break;
    pieces.push(visible);
    used += visible.length;
    cursor = next;
  }
  return { text: (reverse ? pieces.reverse() : pieces).join(''), start: reverse ? cursor : start, end: reverse ? end : cursor };
}

/** Diagnostics may themselves quote a megabyte-long identifier or payload. */
export function shortDiagnostic(text: string): string {
  const part = take(text, 0, text.length, 1200);
  return part.text + (part.end < text.length ? ' ... [diagnostic shortened; use --format json for full text]' : '');
}

/** The exact reported span is bracketed, avoiding a caret whose terminal column
 * changes when controls are escaped or Unicode occupies multiple display cells.
 * No rescan: clipping context must not change the original finding or its policy. */
export function sourceExcerpt(source: string, finding: Finding): string {
  const start = finding.start.offset;
  const end = finding.end.offset;
  const before = take(source, 0, start, 32, true, true);
  const after = take(source, end, source.length, 32, false, true);
  let span = take(source, start, end, 80);
  let selected = span.text;
  if (span.end < end) {
    span = take(source, start, end, 40);
    const tail = take(source, span.end, end, 40, true);
    selected = `${span.text} ... [${tail.start - span.end} UTF-16 units omitted] ... ${tail.text}`;
  }
  const prefix = before.start > 0 && !lineBreak(source[before.start - 1]) ? '... ' : '';
  const suffix = after.end < source.length && !lineBreak(source[after.end]) ? ' ...' : '';
  return `${prefix}${before.text}[[${selected}]]${after.text}${suffix}`;
}
