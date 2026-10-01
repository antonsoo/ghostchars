import type { Position } from '../types.js';
import type { CodePointInfo } from '../unicode-utils.js';

/**
 * Maps UTF-16 code-unit offsets back to 1-based line/column positions, for
 * rules that work over raw string indices (decodeTags,
 * decodeVariationSelectors) rather than the streamed code point iterator.
 *
 * The line breaks are found once; each lookup is then a binary search. A
 * rule used to rescan the text from its start for both ends of every
 * finding, which made a scan quadratic: 60 KB with 30,000 stray selectors
 * took three seconds, and a few megabytes took minutes.
 */
/** Looks up the position of a UTF-16 offset in one particular text. */
export type PositionLookup = (index: number) => Position;

export function positionIndex(text: string): PositionLookup {
  // Offsets of the characters that end a line: "\n", or a "\r" not followed by "\n".
  // Found on the first lookup, so text with nothing to report is not walked for them.
  let breaks: number[] | undefined;
  const lineBreaks = (): number[] => {
    const found: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x0a || (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) found.push(i);
    }
    return found;
  };
  return (index) => {
    breaks ??= lineBreaks();
    // How many line breaks lie before `index`.
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (breaks[mid]! < index) lo = mid + 1;
      else hi = mid;
    }
    const lastBreak = lo === 0 ? -1 : breaks[lo - 1]!;
    return { line: lo + 1, column: index - lastBreak, offset: index };
  };
}

/** One position, for a caller with a single offset to convert. O(n): see {@link positionIndex}. */
export function indexToPosition(text: string, index: number): Position {
  return positionIndex(text.slice(0, index + 1))(index);
}

/** The code point at `index` with its width and position, as the rules report it. */
export function describeCodePoint(text: string, index: number, positionAt: PositionLookup): CodePointInfo {
  const codePoint = text.codePointAt(index)!;
  const { line, column } = positionAt(index);
  return { codePoint, index, width: codePoint > 0xffff ? 2 : 1, line, column };
}
