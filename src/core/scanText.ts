import { scanBidi } from './rules/bidi.js';
import { scanConfusables } from './rules/confusables.js';
import { scanInvisible } from './rules/invisible.js';
import { scanTags } from './rules/tags.js';
import { scanVariationSelectors } from './rules/variationSelectors.js';
import { scanWhitespaceAndControl } from './rules/whitespaceControl.js';
import type { Finding, ScanOptions, ScanResult, Severity } from './types.js';
import { iterateCodePoints } from './unicode-utils.js';

// Every rule ghostchars implements is triggered by either a code point
// >= 0x80, or a C0/DEL control character other than tab/LF/CR. If neither
// appears anywhere in the text, no rule can possibly find anything: there's
// nothing to reorder (bidi), nothing invisible, no tag/variation-selector
// block, no non-ASCII to be confusable with, and no unusual
// whitespace/control character. This one linear regex scan lets the fast,
// overwhelmingly common case (a plain ASCII file) skip code point
// iteration, tokenizing, and every per-rule pass entirely, rather than
// proving the same "nothing here" result the expensive way.
const HAS_NON_ASCII_OR_CONTROL_RE = /[^\t\n\r\x20-\x7E]/;

export function scanText(text: string, options: ScanOptions = {}): ScanResult {
  if (!HAS_NON_ASCII_OR_CONTROL_RE.test(text)) {
    return { findings: [], codePointCount: text.length };
  }

  const codePoints = iterateCodePoints(text);

  const findings = [...scanBidi(codePoints, text), ...scanTags(text), ...scanVariationSelectors(text), ...scanInvisible(codePoints), ...scanConfusables(text), ...scanWhitespaceAndControl(codePoints)];

  const allow = new Set(options.allowCodePoints ?? []);
  const filtered = findings
    .filter((f) => !f.codePoints.every((cp) => allow.has(cp)))
    .map((f) => applySeverityOverride(f, options))
    .filter((f): f is Finding => f !== null)
    .map((f) => (options.file ? { ...f, file: options.file } : f));

  filtered.sort((a, b) => a.start.offset - b.start.offset || a.rule.localeCompare(b.rule));

  return { findings: filtered, codePointCount: codePoints.length };
}

function applySeverityOverride(finding: Finding, options: ScanOptions): Finding | null {
  const override = options.severityOverrides?.[finding.rule];
  if (override === undefined) return finding;
  if (override === false) return null;
  return { ...finding, severity: override as Severity };
}
