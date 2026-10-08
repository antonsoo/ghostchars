import { decodeSelectorBitStream, decodeVariationSelectors, unwrapPayload, type VariationSelectorRun } from '../decodeVariationSelectors.js';
import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import type { PositionLookup } from './position.js';

export function scanVariationSelectors(text: string, positionAt: PositionLookup): Finding[] {
  const findings: Finding[] = [];
  const runs = decodeVariationSelectors(text);
  const bitStream = decodeSelectorBitStream(runs);
  const bitCarriers = new Map(bitStream?.runs.map((run, index) => [run, index]));
  for (const run of runs) {
    if (run.isOrdinaryPresentationSelector) continue;

    const codePoints = run.baseCodePoint !== undefined ? [run.baseCodePoint, ...bytesToSelectors(run.bytes)] : bytesToSelectors(run.bytes);
    const bitIndex = bitCarriers.get(run);
    const isSmuggling = bitIndex !== undefined || (run.decodedText !== undefined && run.bytes.length > 1);
    const payload = bitIndex !== undefined ? { text: bitStream!.text, layers: 1 } : run.decodedText !== undefined ? unwrapPayload(run.decodedText) : undefined;

    findings.push({
      rule: isSmuggling ? 'variation-selector-smuggling' : 'variation-selector-stray',
      severity: isSmuggling ? 'error' : 'warning',
      start: positionAt(run.start),
      end: positionAt(run.end),
      codePoints,
      names: codePoints.map(unicodeName),
      message: smugglingMessage(run, bitIndex, bitStream?.runs.length, bitStream?.vs16IsOne, payload)
        ?? (run.baseCodePoint === undefined
          ? 'Variation selector with no preceding base character to apply a glyph variant to.'
          : run.afterPresentationSelector
            ? `${run.bytes.length} extra variation selector${run.bytes.length === 1 ? '' : 's'} after U+${run.baseCodePoint.toString(16).toUpperCase()} (${unicodeName(run.baseCodePoint)}) and the selector that already picks its presentation: ${run.bytes.length === 1 ? 'it does' : 'they do'} nothing and cannot be seen.`
          : `Variation selector on U+${run.baseCodePoint.toString(16).toUpperCase()} (${unicodeName(run.baseCodePoint)}), which has no registered variation sequence for it.`),
      suggestion: run.afterPresentationSelector
        ? 'Remove the extra selectors; the first one, which keeps the emoji presentation, stays.'
        : 'Remove these characters unless selecting a real registered variation sequence (see the Unicode IVD / StandardizedVariants.txt).',
      // On a bit stream the message is spread over every carrier; it is said once, at the first.
      decoded: bitIndex !== undefined && bitIndex > 0 ? undefined : payload?.text,
      fixable: true,
      // The finding points at the base character, but only the selectors are removed.
      ...(run.selectorsStart > run.start ? { removal: { start: run.selectorsStart, end: run.end } } : {}),
    });
  }
  return findings;
}

function smugglingMessage(run: VariationSelectorRun, bitIndex: number | undefined, bitCount: number | undefined, vs16IsOne: boolean | undefined, payload: { text: string; layers: number } | undefined): string | undefined {
  if (payload === undefined) return undefined;
  if (bitIndex !== undefined) {
    const polarity = vs16IsOne ? 'VS16 = 1, VS15 = 0' : 'VS15 = 1, VS16 = 0';
    return bitIndex === 0
      ? `${bitCount} single variation selectors, one after each of a run of ordinary characters, are a bit apiece (${polarity}) and read together spell hidden UTF-8 text: ${JSON.stringify(payload.text)}.`
      : `Bit ${bitIndex + 1} of ${bitCount} of the hidden message decoded at the first selector of this run.`;
  }
  const layers = payload.layers > 1 ? ` The payload is itself written in selectors, ${payload.layers} layers deep.` : '';
  return `${run.bytes.length} variation selectors decode as hidden UTF-8 text via the byte-per-selector smuggling scheme (VS1-16 -> 0-15, VS17-256 -> 16-255): ${JSON.stringify(payload.text)}.${layers}`;
}

function bytesToSelectors(bytes: number[]): number[] {
  return bytes.map((b) => (b < 16 ? 0xfe00 + b : 0xe0100 + (b - 16)));
}
