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
  if ((policy.mode ?? 'remove') === 'keep') {
    return { text, fixed: [], remaining: scanText(text).findings };
  }

  // Removing one character can turn its neighbor into a finding (see SanitizeResult.fixed), so
  // scan and remove until a scan comes back clean. Every pass that continues deletes at least
  // one code unit, so this ends.
  let current = text;
  const fixed: Finding[] = [];
  for (;;) {
    const remaining: Finding[] = [];
    const spans: Array<[number, number]> = [];
    for (const finding of scanText(current).findings) {
      if (finding.fixable && rules.has(finding.rule)) {
        fixed.push(finding);
        spans.push(finding.removal ? [finding.removal.start, finding.removal.end] : [finding.start.offset, finding.end.offset]);
      } else {
        remaining.push(finding);
      }
    }
    if (spans.length === 0) return { text: current, fixed, remaining };

    const merged = mergeSpans(spans);
    let out = current;
    for (let i = merged.length - 1; i >= 0; i--) {
      const [start, end] = merged[i]!;
      out = out.slice(0, start) + out.slice(end);
    }
    if (out.length === current.length) return { text: current, fixed, remaining };
    current = out;
  }
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
