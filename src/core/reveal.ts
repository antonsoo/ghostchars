import { scanText } from './scanText.js';
import type { Finding } from './types.js';

const ABBR: ReadonlyMap<number, string> = new Map([
  [0x202a, 'LRE'],
  [0x202b, 'RLE'],
  [0x202c, 'PDF'],
  [0x202d, 'LRO'],
  [0x202e, 'RLO'],
  [0x2066, 'LRI'],
  [0x2067, 'RLI'],
  [0x2068, 'FSI'],
  [0x2069, 'PDI'],
  [0x200e, 'LRM'],
  [0x200f, 'RLM'],
  [0x061c, 'ALM'],
  [0x200b, 'ZWSP'],
  [0x200c, 'ZWNJ'],
  [0x200d, 'ZWJ'],
  [0x2060, 'WJ'],
  [0xfeff, 'BOM'],
  [0x00a0, 'NBSP'],
  [0x00ad, 'SHY'],
  [0x034f, 'CGJ'],
  [0x180e, 'MVS'],
  [0x0085, 'NEL'],
  [0x3164, 'HF'],
  [0xffa0, 'HHF'],
  [0x115f, 'HCF'],
  [0x1160, 'HJF'],
  [0x001b, 'ESC'],
]);

/**
 * Renders `text` with every flagged code point replaced by a visible label
 * (e.g. `⟦U+202E RLO⟧`), and appends decoded payloads for smuggling
 * findings. Ordinary text passes through unchanged. This is the same
 * annotation used by `ghostchars reveal` and the web "UV lamp" view.
 */
export function reveal(text: string): string {
  const { findings } = scanText(text);
  const byStart = new Map<number, Finding>();
  for (const f of findings) {
    if (!byStart.has(f.start.offset)) byStart.set(f.start.offset, f);
  }

  let out = '';
  let i = 0;
  while (i < text.length) {
    const finding = byStart.get(i);
    if (finding) {
      const label = finding.codePoints.map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${ABBR.get(cp) ?? shortName(finding, cp)}`).join(' ');
      out += `⟦${label}⟧`;
      if (finding.decoded) out += ` → "${finding.decoded}"`;
      i = Math.max(finding.end.offset, i + 1);
      continue;
    }
    const cp = text.codePointAt(i)!;
    out += String.fromCodePoint(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}

function shortName(finding: Finding, cp: number): string {
  const idx = finding.codePoints.indexOf(cp);
  return finding.names[idx] ?? finding.rule;
}
