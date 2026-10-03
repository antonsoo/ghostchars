import type { Finding } from '../../src/core/index.js';
import { diagnosticText } from '../../src/core/diagnosticText.js';

const ABBR: Record<number, string> = {
  0x202a: 'LRE',
  0x202b: 'RLE',
  0x202c: 'PDF',
  0x202d: 'LRO',
  0x202e: 'RLO',
  0x2066: 'LRI',
  0x2067: 'RLI',
  0x2068: 'FSI',
  0x2069: 'PDI',
  0x200e: 'LRM',
  0x200f: 'RLM',
  0x061c: 'ALM',
  0x200b: 'ZWSP',
  0x200c: 'ZWNJ',
  0x200d: 'ZWJ',
  0x2060: 'WJ',
  0xfeff: 'BOM',
  0x00a0: 'NBSP',
  0x00ad: 'SHY',
  0x001b: 'ESC',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function codeLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Renders `text` as HTML: every non-confusable finding becomes a glowing
 * `.gc-chip`, and confusable spans stay as real (still-selectable, still
 * copyable) text underlined in the "revealed ink" color. This is the DOM
 * counterpart of the core `reveal()` string function -- same idea, but with
 * real elements so hover/tooltips and CSS glow are possible.
 */
export function renderRevealedHtml(text: string, findings: Finding[]): string {
  const byStart = new Map<number, Finding>();
  const confusables: Finding[] = [];
  for (const f of findings) {
    if (f.rule === 'confusable') {
      confusables.push(f);
      continue;
    }
    if ((byStart.get(f.start.offset)?.end.offset ?? -1) < f.end.offset) byStart.set(f.start.offset, f);
  }
  // Only keep the first confusable finding covering any given start offset,
  // so overlapping "mixes scripts" + "collides with" findings on the same
  // token don't double-wrap it.
  const confusableStarts = new Map<number, Finding>();
  for (const f of confusables) if (!confusableStarts.has(f.start.offset)) confusableStarts.set(f.start.offset, f);

  let html = '';
  let i = 0;
  let markedUntil = -1;
  while (i < text.length) {
    if (markedUntil >= 0 && i >= markedUntil) {
      html += '</mark>';
      markedUntil = -1;
    }
    const confusable = confusableStarts.get(i);
    if (confusable && markedUntil < 0) {
      html += `<mark class="gc-confusable" title="${escapeHtml(diagnosticText(confusable.message))}">`;
      markedUntil = confusable.end.offset;
    }
    const chip = byStart.get(i);
    if (chip) {
      const sevClass = `sev-${chip.severity}`;
      const label = chip.codePoints.length > 3 ? `${codeLabel(chip.codePoints[0]!)}…(${chip.codePoints.length})` : chip.codePoints.map((cp) => ABBR[cp] ?? codeLabel(cp)).join(' ');
      const title = escapeHtml(diagnosticText(chip.decoded ? `${chip.message} -> ${JSON.stringify(chip.decoded)}` : chip.message));
      html += `<span class="gc-chip ${sevClass}" title="${title}">${escapeHtml(label)}</span>`;
      i = Math.max(chip.end.offset, i + 1);
      continue;
    }
    const cp = text.codePointAt(i)!;
    html += escapeHtml(String.fromCodePoint(cp));
    i += cp > 0xffff ? 2 : 1;
  }
  if (markedUntil >= 0) html += '</mark>';
  return html || '<span class="empty">(empty)</span>';
}
