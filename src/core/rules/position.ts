import type { Position } from '../types.js';

/**
 * Converts a UTF-16 code-unit offset back into a 1-based line/column. Used
 * by rules that work over raw string indices (decodeTags,
 * decodeVariationSelectors) rather than the streamed code point iterator.
 * O(n) per call; fine at CLI scale, and rules call it a handful of times
 * per finding rather than per character.
 */
export function indexToPosition(text: string, index: number): Position {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) {
      line++;
      lastNewline = i;
    } else if (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: index - lastNewline, offset: index };
}
