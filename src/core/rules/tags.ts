import { decodeTags } from '../decodeTags.js';
import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import { indexToPosition } from './position.js';

export function scanTags(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const run of decodeTags(text)) {
    if (run.isValidEmojiTagSequence) continue;
    const printable = run.decoded.replace(/[^\x20-\x7e]/g, '');
    findings.push({
      rule: 'tag-smuggling',
      severity: 'error',
      start: indexToPosition(text, run.start),
      end: indexToPosition(text, run.end),
      codePoints: run.codePoints,
      names: run.codePoints.map(unicodeName),
      message: run.hasEmojiBase
        ? `Unicode tag characters after an emoji base do not form a valid emoji tag sequence (only flag sequences like U+1F3F4 + letters + U+E007F are legitimate). Decoded payload: ${JSON.stringify(printable)}.`
        : `Unicode tag characters (U+E0000-U+E007F) with no legitimate emoji base -- these are invisible outside the code point inspector and decode to hidden ASCII: ${JSON.stringify(printable)}.`,
      suggestion: 'Remove these characters. Legitimate use is limited to RGI emoji tag sequences (regional flags).',
      decoded: printable,
      fixable: true,
    });
  }
  return findings;
}
