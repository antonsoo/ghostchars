import { isEmoji } from './unicode-utils.js';

// Standard use: exactly one variation selector after a base character picks
// a glyph variant (VS15/VS16 = text/emoji presentation, or an entry in the
// Unicode Ideographic Variation Database for CJK ideographs).
//
// Smuggling use (documented informally as "variation selector smuggling",
// used to hide instructions in text shown to LLMs): a *run* of variation
// selectors after any base character encodes arbitrary bytes, since the 16
// selectors in U+FE00-FE0F plus the 240 in U+E0100-E01EF give 256 code
// points -- one per byte value. Byte b maps to U+FE00+b for b in 0-15, or
// U+E0100+(b-16) for b in 16-255.

const VS_LOW_START = 0xfe00;
const VS_LOW_END = 0xfe0f;
const VS_HIGH_START = 0xe0100;
const VS_HIGH_END = 0xe01ef;

const CJK_IDEOGRAPH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0x20000, 0x2fa1f], // Extensions B-F + Compatibility Supplement
];

function isCjkIdeograph(cp: number): boolean {
  return CJK_IDEOGRAPH_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

export function isVariationSelector(cp: number): boolean {
  return (cp >= VS_LOW_START && cp <= VS_LOW_END) || (cp >= VS_HIGH_START && cp <= VS_HIGH_END);
}

function selectorToByte(cp: number): number {
  if (cp >= VS_LOW_START && cp <= VS_LOW_END) return cp - VS_LOW_START;
  return cp - VS_HIGH_START + 16;
}

export interface VariationSelectorRun {
  /** UTF-16 index of the base character (or of the first selector, if stray). */
  start: number;
  /** UTF-16 index one past the last selector in the run. */
  end: number;
  baseCodePoint: number | undefined;
  bytes: number[];
  /** `bytes` decoded as UTF-8, if valid; undefined otherwise. */
  decodedText: string | undefined;
  /** True for an ordinary single presentation-selector use that should not be flagged. */
  isOrdinaryPresentationSelector: boolean;
}

export function decodeVariationSelectors(text: string): VariationSelectorRun[] {
  const runs: VariationSelectorRun[] = [];
  let i = 0;
  let prevCp: number | undefined;
  let prevStart = -1;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (isVariationSelector(cp)) {
      const runStart = prevCp !== undefined && prevStart >= 0 && prevStart + codePointWidth(prevCp) === i ? prevStart : i;
      const base = runStart === i ? undefined : prevCp;
      const bytes: number[] = [];
      let j = i;
      while (j < text.length) {
        const c = text.codePointAt(j)!;
        if (!isVariationSelector(c)) break;
        bytes.push(selectorToByte(c));
        j += c > 0xffff ? 2 : 1;
      }
      // Emoji only ever take VS15 (text) / VS16 (emoji presentation). CJK
      // ideographs can take any single selector -- the actual registered
      // pairing lives in the Unicode Ideographic Variation Database, which
      // we don't vendor, so a single selector on a CJK base is treated as
      // an ordinary (if unverified) IVS rather than flagged.
      const isOrdinaryPresentationSelector = bytes.length === 1 && base !== undefined && ((isEmoji(base) && (bytes[0] === 14 || bytes[0] === 15)) || isCjkIdeograph(base));
      runs.push({
        start: runStart,
        end: j,
        baseCodePoint: base,
        bytes,
        decodedText: tryDecodeUtf8(bytes),
        isOrdinaryPresentationSelector,
      });
      i = j;
      prevCp = undefined;
      prevStart = -1;
      continue;
    }
    prevCp = cp;
    prevStart = i;
    i += width;
  }
  return runs;
}

function codePointWidth(cp: number): number {
  return cp > 0xffff ? 2 : 1;
}

function tryDecodeUtf8(bytes: number[]): string | undefined {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    // Reject payloads that are just C0 control noise -- not a useful "decoded" string.
    if ([...decoded].every((ch) => ch.codePointAt(0)! < 0x20)) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}
