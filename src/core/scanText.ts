import { scanBidi } from './rules/bidi.js';
import { scanConfusables } from './rules/confusables.js';
import { scanInvisible } from './rules/invisible.js';
import { scanTags } from './rules/tags.js';
import { scanVariationSelectors } from './rules/variationSelectors.js';
import { scanWhitespaceAndControl } from './rules/whitespaceControl.js';
import type { Finding, ScanOptions, ScanResult, Severity } from './types.js';
import { iterateCodePoints } from './unicode-utils.js';

export function scanText(text: string, options: ScanOptions = {}): ScanResult {
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
