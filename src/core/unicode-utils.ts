import { defaultIgnorableRanges } from '../generated/default-ignorable.js';
import { emojiRanges } from '../generated/emoji.js';
import { scriptExtensionRanges } from '../generated/script-extensions.js';
import { scriptNames, scriptRanges } from '../generated/scripts.js';

/** One code point of a text that a rule has something to say about. */
export interface CodePointInfo {
  codePoint: number;
  /** Index of the first UTF-16 code unit of this code point. */
  index: number;
  /** Number of UTF-16 code units (1 or 2). */
  width: number;
  line: number;
  column: number;
}

/**
 * The code point that ends just before UTF-16 index `index`, or undefined at
 * the start of the text. A low surrogate preceded by a high one is read as
 * the pair, the same way `codePointAt` reads it going forwards.
 */
export function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) return undefined;
  const last = text.charCodeAt(index - 1);
  if (last >= 0xdc00 && last <= 0xdfff && index >= 2) {
    const first = text.charCodeAt(index - 2);
    if (first >= 0xd800 && first <= 0xdbff) return (first - 0xd800) * 0x400 + (last - 0xdc00) + 0x10000;
  }
  return last;
}

/** How many code points `text` holds: its UTF-16 length, less one for each surrogate pair. */
export function countCodePoints(text: string): number {
  let pairs = 0;
  SURROGATE_PAIR_RE.lastIndex = 0;
  while (SURROGATE_PAIR_RE.exec(text) !== null) pairs++;
  return text.length - pairs;
}

const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

/** A character class matching exactly the code points in `ranges`, for a `u`-flag regular expression. */
export function rangesToClass(ranges: ReadonlyArray<readonly [number, number, ...unknown[]]>): string {
  const hex = (cp: number) => `\\u{${cp.toString(16)}}`;
  return `[${ranges.map(([lo, hi]) => (lo === hi ? hex(lo) : `${hex(lo)}-${hex(hi)}`)).join('')}]`;
}

function rangeSearch(ranges: ReadonlyArray<readonly [number, number, ...unknown[]]>, cp: number): number {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const [start, end] = ranges[mid]!;
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function inRanges(ranges: ReadonlyArray<readonly [number, number]>, cp: number): boolean {
  return rangeSearch(ranges, cp) >= 0;
}

export function isDefaultIgnorable(cp: number): boolean {
  return inRanges(defaultIgnorableRanges, cp);
}

export function isEmoji(cp: number): boolean {
  return inRanges(emojiRanges, cp);
}

/** Returns every Script/Script_Extensions name a code point belongs to (usually one). */
export function scriptsOf(cp: number): string[] {
  const out = new Set<string>();
  const idx = rangeSearch(scriptRanges, cp);
  if (idx >= 0) out.add(scriptNames[scriptRanges[idx]![2]]!);
  const extIdx = rangeSearch(scriptExtensionRanges, cp);
  if (extIdx >= 0) {
    for (const id of scriptExtensionRanges[extIdx]![2]) out.add(scriptNames[id]!);
  }
  return [...out];
}

export const REGIONAL_INDICATOR_START = 0x1f1e6;
export const REGIONAL_INDICATOR_END = 0x1f1ff;

export function isRegionalIndicator(cp: number): boolean {
  return cp >= REGIONAL_INDICATOR_START && cp <= REGIONAL_INDICATOR_END;
}
