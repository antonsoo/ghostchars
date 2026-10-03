import { sanitize, scanText } from '../../src/core/index.js';
import type { Finding, Severity } from '../../src/core/index.js';
import { diagnosticText } from '../../src/core/diagnosticText.js';
import { revealWithFindings } from '../../src/core/reveal.js';
import { renderRevealedHtml } from './renderRevealed.js';

import { MAX_INPUT_CODE_UNITS, MAX_PREVIEW_CODE_UNITS, MAX_DISPLAY_FINDINGS } from './limits.js';

export interface FindingView {
  rule: Finding['rule'];
  severity: Severity;
  start: Finding['start'];
  end: Finding['end'];
  message: string;
  suggestion: string;
}

export interface Inspection {
  counts: Record<Severity, number>;
  codePointCount: number;
  totalFindings: number;
  findings: FindingView[];
  decoded: FindingView[];
  decodedCount: number;
  confusables: FindingView[];
  confusableCount: number;
  previewText: string;
  previewUnits: number;
  revealedHtml: string;
  logicalText: string;
  sanitized: { text: string; removedUnits: number; remainingCount: number; remaining: FindingView[] };
}

function view(finding: Finding): FindingView {
  const display = (text: string): string => {
    const visible = diagnosticText(text);
    return visible.length > 1600 ? visible.slice(0, 1600) + ' [diagnostic shortened]' : visible;
  };
  return { rule: finding.rule, severity: finding.severity, start: finding.start, end: finding.end, message: display(finding.message), suggestion: display(finding.suggestion) };
}

/** Scan the complete input; cap only rendered evidence, never totals or copied output. */
export function inspectText(text: string): Inspection {
  if (text.length > MAX_INPUT_CODE_UNITS) throw new Error('This browser view accepts up to 100,000 UTF-16 code units. Use the CLI for larger files. Nothing was scanned or copied.');
  const scan = scanText(text);
  const { findings } = scan;
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity]++;
  const decoded = findings.filter((finding) => finding.decoded !== undefined);
  const confusables = findings.filter((finding) => finding.rule === 'confusable');
  let end = Math.min(text.length, MAX_PREVIEW_CODE_UNITS, findings[MAX_DISPLAY_FINDINGS]?.start.offset ?? Infinity);
  // Walk backwards so moving the cut before an overlapping span also visits its ancestors.
  for (let i = findings.length - 1; i >= 0; i--) {
    const finding = findings[i]!;
    if (finding.start.offset < end && finding.end.offset > end) end = finding.start.offset;
  }
  if (end > 0 && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
  const previewText = text.slice(0, end);
  const previewFindings = findings.filter((finding) => finding.end.offset <= end);
  const clean = sanitize(text);
  return {
    counts, codePointCount: scan.codePointCount, totalFindings: findings.length,
    findings: findings.slice(0, MAX_DISPLAY_FINDINGS).map(view),
    decoded: decoded.slice(0, MAX_DISPLAY_FINDINGS).map(view), decodedCount: decoded.length,
    confusables: confusables.slice(0, MAX_DISPLAY_FINDINGS).map(view), confusableCount: confusables.length,
    previewText, previewUnits: end,
    revealedHtml: renderRevealedHtml(previewText, previewFindings),
    logicalText: revealWithFindings(previewText, previewFindings),
    sanitized: { text: clean.text, removedUnits: text.length - clean.text.length, remainingCount: clean.remaining.length, remaining: clean.remaining.slice(0, 20).map(view) },
  };
}
