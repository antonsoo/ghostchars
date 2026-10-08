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
  /** UTF-16 index of the first selector: `start`, or just after the base character. */
  selectorsStart: number;
  /** UTF-16 index one past the last selector in the run. */
  end: number;
  baseCodePoint: number | undefined;
  bytes: number[];
  /** `bytes` decoded as UTF-8, if valid; undefined otherwise. */
  decodedText: string | undefined;
  /** True for an ordinary single presentation-selector use that should not be flagged. */
  isOrdinaryPresentationSelector: boolean;
  /**
   * True when the run follows an emoji whose first selector already picked its presentation:
   * `selectorsStart` is then the first selector after that one, and only those are stray.
   */
  afterPresentationSelector?: boolean;
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
      const decodedText = tryDecodeUtf8(bytes);
      // A heart followed by VS16 twice, as editors and copy-paste leave it: the first selector
      // is the registered emoji presentation and stays; the rest are the stray ones. Not when
      // the run decodes as text, which is a payload that happens to begin with that byte.
      const keepsFirst = bytes.length > 1 && decodedText === undefined && base !== undefined && isEmoji(base) && (bytes[0] === 14 || bytes[0] === 15);
      runs.push({
        start: runStart,
        selectorsStart: keepsFirst ? i + 1 : i,
        end: j,
        baseCodePoint: base,
        bytes: keepsFirst ? bytes.slice(1) : bytes,
        decodedText,
        isOrdinaryPresentationSelector,
        ...(keepsFirst ? { afterPresentationSelector: true } : {}),
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

/** The deepest a payload is unwrapped: one that is itself written in selectors, and so on. */
const MAX_PAYLOAD_LAYERS = 8;

function smugglingRuns(text: string): VariationSelectorRun[] {
  return decodeVariationSelectors(text).filter((run) => run.decodedText !== undefined && run.bytes.length > 1);
}

/**
 * A payload can be written in selectors again: the decoded text is an emoji followed by another
 * run of selectors, and that decodes to an emoji and a third run. A reader who stops at the
 * first layer is shown a string of invisible characters as the "message". This decodes each
 * run found in the text and splices its text in (the carrier emoji stays), up to
 * MAX_PAYLOAD_LAYERS deep, and reports how many layers it took.
 */
export function unwrapPayload(decoded: string): { text: string; layers: number } {
  let text = decoded;
  let layers = 1;
  while (layers < MAX_PAYLOAD_LAYERS) {
    const inner = smugglingRuns(text);
    if (inner.length === 0) break;
    for (const run of inner.reverse()) text = text.slice(0, run.selectorsStart) + run.decodedText + text.slice(run.end);
    layers++;
  }
  return { text, layers };
}

export interface SelectorBitStream {
  /** The selectors that carry a bit each, in text order. */
  runs: VariationSelectorRun[];
  /** The bits read as UTF-8 text. */
  text: string;
  /** True when VS16 is a one bit and VS15 a zero; false for the other way round. */
  vs16IsOne: boolean;
}

// A message shorter than this is as likely to be chance as a message.
const MIN_BIT_STREAM_BYTES = 8;

function isPlainText(text: string): boolean {
  // eslint-disable-next-line no-control-regex -- C0 controls other than tab, LF and CR are exactly what is being excluded.
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd]/.test(text);
}

function bitsToText(bits: number[]): string | undefined {
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k]!;
    bytes.push(byte);
  }
  if (bytes.length < MIN_BIT_STREAM_BYTES) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    return isPlainText(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The other way to hide text in selectors, seen in a jailbreak collection: a single VS15 or
 * VS16 after each word or letter of an innocent paragraph, one bit apiece (VS16 = 1), eight
 * to a byte. No one selector is unusual, so each is only a stray one; read together, in text
 * order, they spell a sentence. Reported only when the bits decode to at least
 * MIN_BIT_STREAM_BYTES bytes of clean UTF-8 text, which a scatter of ordinary stray selectors
 * does not do.
 */
export function decodeSelectorBitStream(runs: VariationSelectorRun[]): SelectorBitStream | undefined {
  const carriers = runs.filter((run) => !run.isOrdinaryPresentationSelector && run.baseCodePoint !== undefined && run.bytes.length === 1 && (run.bytes[0] === 14 || run.bytes[0] === 15));
  if (carriers.length < MIN_BIT_STREAM_BYTES * 8) return undefined;
  for (const vs16IsOne of [true, false]) {
    const text = bitsToText(carriers.map((run) => ((run.bytes[0] === 15) === vs16IsOne ? 1 : 0)));
    if (text !== undefined) return { runs: carriers, text, vs16IsOne };
  }
  return undefined;
}
