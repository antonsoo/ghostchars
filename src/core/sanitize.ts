import { scanText } from './scanText.js';
import type { Finding, RuleId, SanitizePolicy, SanitizeResult } from './types.js';

const DEFAULT_FIXABLE_RULES: RuleId[] = ['bidi-control', 'bidi-mark', 'bidi-unbalanced', 'tag-smuggling', 'variation-selector-smuggling', 'variation-selector-stray', 'invisible', 'unusual-whitespace', 'control-character'];

/**
 * Removes the code points behind fixable findings. Intended for use as an
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
  if ((policy.mode ?? 'remove') === 'keep') {
    return { text, fixed: [], remaining: scanText(text, options).findings };
  }

  // Removing one character can turn its neighbor into a finding (see SanitizeResult.fixed), so
  // scan and remove until no permitted deletion remains. Every pass that continues deletes
  // at least one code unit, so this ends even when protected findings remain.
  let current = text;
  const fixed: Finding[] = [];
  for (;;) {
    const remaining: Finding[] = [];
    const spans: Array<[number, number]> = [];
    for (const finding of scanText(current, options).findings) {
      if (finding.fixable && rules.has(finding.rule)) {
        const start = finding.removal?.start ?? finding.start.offset;
        const end = finding.removal?.end ?? finding.end.offset;
        const removable = unprotectedSpans(current, start, end, allowed);
        if (removable.length) {
          fixed.push(finding);
          spans.push(...removable);
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
      cursor = end;
    }
    kept.push(current.slice(cursor));
    const out = kept.join('');
    if (out.length === current.length) return { text: current, fixed, remaining };
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
