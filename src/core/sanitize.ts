import { scanText } from './scanText.js';
import type { Finding, RuleId, SanitizePolicy, SanitizeResult } from './types.js';

const DEFAULT_FIXABLE_RULES: RuleId[] = ['bidi-control', 'bidi-mark', 'bidi-unbalanced', 'tag-smuggling', 'variation-selector-smuggling', 'variation-selector-stray', 'invisible', 'unusual-whitespace', 'control-character'];

/**
 * Edits the code points behind fixable findings. Removal remains the default;
 * normalize mode preserves whitespace boundaries with ASCII spaces/newlines.
 * Intended for use as an
 * LLM input filter (strip smuggled instructions before the model ever sees
 * them) as much as for `--fix`. Confusables are never auto-fixed: renaming
 * an identifier is a judgment call, not a safe mechanical removal.
 */
export function sanitize(text: string, policy: SanitizePolicy = {}): SanitizeResult {
  const rules = new Set(policy.rules ?? DEFAULT_FIXABLE_RULES);
  // Materialize once: callers may supply a one-shot iterable, and later passes
  // must retain exactly the same allowlist as the first scan.
  const allowed = new Set(policy.scanOptions?.allowCodePoints ?? []);
  const options = { ...policy.scanOptions, allowCodePoints: allowed };
  const mode = policy.mode ?? 'remove';
  if (mode === 'keep') {
    return { text, fixed: [], remaining: scanText(text, options).findings };
  }

  // Removing one character can turn its neighbor into a finding (see SanitizeResult.fixed), so
  // scan and edit until no permitted change remains. Every pass removes or
  // replaces a flagged scalar; normal ASCII whitespace introduces no new findings.
  let current = text;
  const fixed: Finding[] = [];
  for (;;) {
    const remaining: Finding[] = [];
    const spans: Array<[number, number]> = [];
    const normalized = mode === 'normalize' ? new Map<number, string>() : null;
    for (const finding of scanText(current, options).findings) {
      if (finding.fixable && rules.has(finding.rule)) {
        const start = finding.removal?.start ?? finding.start.offset;
        const end = finding.removal?.end ?? finding.end.offset;
        const removable = unprotectedSpans(current, start, end, allowed);
        if (removable.length) {
          fixed.push(finding);
          spans.push(...removable);
          if (normalized && finding.rule === 'unusual-whitespace') {
            for (const [from, to] of removable) {
              for (let i = from; i < to; i++) {
                const cp = current.charCodeAt(i);
                // Unicode's line separators retain a line boundary. Other
                // flagged spaces retain a word boundary, including braille blank.
                normalized.set(i, cp === 0x85 || cp === 0x2028 || cp === 0x2029 ? '\n' : ' ');
              }
            }
          }
        } else remaining.push(finding);
      } else {
        remaining.push(finding);
      }
    }
    if (spans.length === 0) return { text: current, fixed, remaining };

    // Keep what lies between the spans, in one pass: cutting them out of the string one at a
    // time copies the rest of the text for every span.
    const kept: string[] = [];
    let cursor = 0;
    for (const [start, end] of mergeSpans(spans)) {
      kept.push(current.slice(cursor, start));
      if (normalized?.size) {
        for (let i = start; i < end; i++) {
          const replacement = normalized.get(i);
          if (replacement !== undefined) kept.push(replacement);
        }
      }
      cursor = end;
    }
    kept.push(current.slice(cursor));
    const out = kept.join('');
    if (out === current) return { text: current, fixed, remaining };
    current = out;
  }
}

/** A compound finding can contain both allowed and disallowed scalars. */
function unprotectedSpans(text: string, start: number, end: number, allowed: ReadonlySet<number>): Array<[number, number]> {
  if (allowed.size === 0) return [[start, end]];
  const spans: Array<[number, number]> = [];
  let from = start;
  for (let i = start; i < end;) {
    const cp = text.codePointAt(i)!;
    const next = i + (cp > 0xffff ? 2 : 1);
    if (allowed.has(cp)) {
      if (from < i) spans.push([from, i]);
      from = next;
    }
    i = next;
  }
  if (from < end) spans.push([from, end]);
  return spans;
}

function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}
