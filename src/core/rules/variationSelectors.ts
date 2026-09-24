import { decodeVariationSelectors } from '../decodeVariationSelectors.js';
import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import { indexToPosition } from './position.js';

export function scanVariationSelectors(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const run of decodeVariationSelectors(text)) {
    if (run.isOrdinaryPresentationSelector) continue;

    const codePoints = run.baseCodePoint !== undefined ? [run.baseCodePoint, ...bytesToSelectors(run.bytes)] : bytesToSelectors(run.bytes);
    const isSmuggling = run.decodedText !== undefined && run.bytes.length > 1;

    findings.push({
      rule: isSmuggling ? 'variation-selector-smuggling' : 'variation-selector-stray',
      severity: isSmuggling ? 'error' : 'warning',
      start: indexToPosition(text, run.start),
      end: indexToPosition(text, run.end),
      codePoints,
      names: codePoints.map(unicodeName),
      message: isSmuggling
        ? `${run.bytes.length} variation selectors decode as hidden UTF-8 text via the byte-per-selector smuggling scheme (VS1-16 -> 0-15, VS17-256 -> 16-255): ${JSON.stringify(run.decodedText)}.`
        : run.baseCodePoint === undefined
          ? 'Variation selector with no preceding base character to apply a glyph variant to.'
          : `Variation selector on U+${run.baseCodePoint.toString(16).toUpperCase()} (${unicodeName(run.baseCodePoint)}), which has no registered variation sequence for it.`,
      suggestion: 'Remove these characters unless selecting a real registered variation sequence (see the Unicode IVD / StandardizedVariants.txt).',
      decoded: run.decodedText,
      fixable: true,
    });
  }
  return findings;
}

function bytesToSelectors(bytes: number[]): number[] {
  return bytes.map((b) => (b < 16 ? 0xfe00 + b : 0xe0100 + (b - 16)));
}
