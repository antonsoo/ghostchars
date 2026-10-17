import { inRanges, isEmoji } from './unicode-utils.js';
import { standardizedVariants } from '../generated/standardized-variants.js';
import { ideographicVariantRanges } from '../generated/ideographic-variants.js';

// Standard use: exactly one variation selector after a base character picks
// a glyph variant (VS15/VS16 = text/emoji presentation, or an entry in the
// Unicode Ideographic Variation Database for CJK ideographs). Standardized
// pairs also select mathematical, punctuation and script-specific variants.
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

// Packing two Unicode scalar values stays below Number.MAX_SAFE_INTEGER.
const registeredVariants = new Set(standardizedVariants.map(([base, selector]) => base * 0x110000 + selector));

function isRegisteredVariant(base: number, selectorByte: number): boolean {
  const selector = selectorByte < 16 ? VS_LOW_START + selectorByte : VS_HIGH_START + selectorByte - 16;
  return registeredVariants.has(base * 0x110000 + selector)
    || (selector >= VS_HIGH_START && inRanges(ideographicVariantRanges, base * 256 + selector - VS_HIGH_START));
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
  /** True for a registered single variant or the existing emoji presentation policy. */
  isOrdinaryPresentationSelector: boolean;
  /**
   * True when the first selector already picked a recognized glyph/presentation variant:
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
      // Exact registrations cover standardized and ideographic variants.
      // A CJK base alone does not establish that an arbitrary selector is a
      // real IVS; that broad exemption hid one-byte-per-ideograph payloads.
      const recognizedFirst = base !== undefined && (isRegisteredVariant(base, bytes[0]!) || (isEmoji(base) && (bytes[0] === 14 || bytes[0] === 15)));
      const isOrdinaryPresentationSelector = bytes.length === 1 && recognizedFirst;
      const decodedText = tryDecodeUtf8(bytes);
      // A recognized variant followed by extra selectors: the first selector
      // stays; the rest are the stray ones. Not when
      // the run decodes as text, which is a payload that happens to begin with that byte.
      const keepsFirst = bytes.length > 1 && decodedText === undefined && recognizedFirst;
      runs.push({
        start: runStart,
        selectorsStart: keepsFirst ? i + (bytes[0]! < 16 ? 1 : 2) : i,
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

// Avoid presenting incidental short selector sequences as complete messages.
const MIN_STREAM_BYTES = 8;

function isPlainText(text: string): boolean {
  // eslint-disable-next-line no-control-regex -- C0 controls other than tab, LF and CR are exactly what is being excluded.
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd]/.test(text);
}

export interface SelectorByteStream {
  runs: VariationSelectorRun[];
  text: string;
}

/** Read one byte per adjacent carrier, without joining unrelated selector sightings.
 * Registered variants are boundaries, never evidence of a hidden message.
 */
export function decodeSelectorByteStreams(runs: VariationSelectorRun[]): SelectorByteStream[] {
  const streams: SelectorByteStream[] = [];
  let chain: VariationSelectorRun[] = [];
  const flush = () => {
    if (chain.length >= MIN_STREAM_BYTES) {
      const text = tryDecodeUtf8(chain.map(run => run.bytes[0]!));
      if (text !== undefined && isPlainText(text)) streams.push({ runs: chain, text });
    }
    chain = [];
  };
  for (const run of runs) {
    if (run.isOrdinaryPresentationSelector || run.baseCodePoint === undefined || run.bytes.length !== 1) {
      flush();
      continue;
    }
    if (chain.length && chain[chain.length - 1]!.end !== run.start) flush();
    chain.push(run);
  }
  flush();
  return streams;
}

function bitsToText(bits: number[]): string | undefined {
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k]!;
    bytes.push(byte);
  }
  if (bytes.length < MIN_STREAM_BYTES) return undefined;
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
 * MIN_STREAM_BYTES bytes of clean UTF-8 text. Decoding establishes what the
 * selectors encode, not whether the author intended an attack.
 */
export function decodeSelectorBitStream(runs: VariationSelectorRun[]): SelectorBitStream | undefined {
  const carriers = runs.filter((run) => !run.isOrdinaryPresentationSelector && run.baseCodePoint !== undefined && run.bytes.length === 1 && (run.bytes[0] === 14 || run.bytes[0] === 15));
  if (carriers.length < MIN_STREAM_BYTES * 8) return undefined;
  for (const vs16IsOne of [true, false]) {
    const text = bitsToText(carriers.map((run) => ((run.bytes[0] === 15) === vs16IsOne ? 1 : 0)));
    if (text !== undefined) return { runs: carriers, text, vs16IsOne };
  }
  return undefined;
}
