import { defaultIgnorableRanges } from '../generated/default-ignorable.js';
import { emojiRanges } from '../generated/emoji.js';
import { scriptExtensionRanges } from '../generated/script-extensions.js';
import { scriptNames, scriptRanges } from '../generated/scripts.js';

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
 * Walks a string one Unicode scalar value at a time, tracking 1-based
 * line/column (in UTF-16 code units, matching how editors report position).
 * Recognizes \n, \r\n and \r as line breaks.
 */
export function* iterateCodePoints(text: string): Generator<CodePointInfo> {
  let line = 1;
  let column = 1;
  let i = 0;
  while (i < text.length) {
    const codePoint = text.codePointAt(i)!;
    const width = codePoint > 0xffff ? 2 : 1;
    yield { codePoint, index: i, width, line, column };
    if (codePoint === 0x0a) {
      line++;
      column = 1;
    } else if (codePoint === 0x0d) {
      // Treat \r and \r\n as a single line break; don't double-count \n.
      if (text[i + width] !== '\n') {
        line++;
        column = 1;
      }
    } else {
      column += width;
    }
    i += width;
  }
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
