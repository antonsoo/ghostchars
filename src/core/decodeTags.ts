// Unicode tag characters (U+E0000-U+E007F) were introduced for language tags
// (deprecated) and are now used only inside RGI emoji tag sequences, e.g. the
// Scotland flag: U+1F3F4 U+E0067 U+E0062 U+E0073 U+E0063 U+E0074 U+E007F,
// which spells "gbsct" in the E0020-E007E block (each tag code point maps to
// an ASCII byte by subtracting 0xE0000). Because that block is a 1:1 mirror
// of ASCII 0x20-0x7E, any tag character appearing outside that narrow flag
// grammar is either meaningless or an attacker smuggling arbitrary ASCII
// text/instructions into something that looks empty -- "ASCII smuggling",
// used in the wild against LLM chat UIs to hide instructions in copy-pasted
// or rendered text.

export const TAG_BASE = 0xe0000;
export const TAG_LANGUAGE_TAG = 0xe0001;
export const TAG_LETTER_START = 0xe0020;
export const TAG_LETTER_END = 0xe007e;
export const TAG_CANCEL = 0xe007f;
export const EMOJI_TAG_BASE = 0x1f3f4;

export interface TagRun {
  /** UTF-16 index of the first code point in the run (the base flag emoji, if present). */
  start: number;
  /** UTF-16 index one past the last code point in the run. */
  end: number;
  codePoints: number[];
  /** ASCII decoded from the tag letters (tag chars map 1:1 onto U+0020-U+007E). */
  decoded: string;
  /** True if this is a well-formed emoji tag sequence: BASE + letters + CANCEL. */
  isValidEmojiTagSequence: boolean;
  /** True if the sequence starts with a recognized emoji base (e.g. the waving flag). */
  hasEmojiBase: boolean;
}

function tagCharToAscii(cp: number): string {
  if (cp >= TAG_LETTER_START && cp <= TAG_LETTER_END) return String.fromCharCode(cp - TAG_BASE);
  return '';
}

/**
 * Finds every maximal run of tag characters in `text` and reports whether
 * each is a structurally valid emoji tag sequence (U+1F3F4 + tag letters +
 * U+E007F) or a stray run -- the latter being the smuggling case. Decodes
 * the tag letters to ASCII either way, since even a "valid" flag sequence's
 * payload is worth showing.
 */
export function decodeTags(text: string): TagRun[] {
  const runs: TagRun[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (cp >= TAG_BASE && cp <= TAG_CANCEL) {
      // Look back precisely for a directly-adjacent EMOJI_TAG_BASE code point.
      const prevIsBase = precedingCodePoint(text, i) === EMOJI_TAG_BASE;
      const start = prevIsBase ? i - 2 : i; // 1F3F4 is a supplementary-plane char: 2 UTF-16 units
      let j = i;
      const codePoints: number[] = [];
      let decoded = '';
      while (j < text.length) {
        const c = text.codePointAt(j)!;
        if (c < TAG_BASE || c > TAG_CANCEL) break;
        codePoints.push(c);
        decoded += tagCharToAscii(c);
        j += c > 0xffff ? 2 : 1;
      }
      const endsWithCancel = codePoints[codePoints.length - 1] === TAG_CANCEL;
      const middleAllLetters = codePoints.slice(0, endsWithCancel ? -1 : undefined).every((c) => c >= TAG_LETTER_START && c <= TAG_LETTER_END);
      const isValidEmojiTagSequence = prevIsBase && endsWithCancel && middleAllLetters && codePoints.length > 1;
      runs.push({
        start: prevIsBase ? start : i,
        end: j,
        codePoints: prevIsBase ? [EMOJI_TAG_BASE, ...codePoints] : codePoints,
        decoded,
        isValidEmojiTagSequence,
        hasEmojiBase: prevIsBase,
      });
      i = j;
      continue;
    }
    i += width;
  }
  return runs;
}

function precedingCodePoint(text: string, index: number): number | undefined {
  if (index < 2) return undefined;
  const lowUnit = text.charCodeAt(index - 1);
  if (lowUnit >= 0xdc00 && lowUnit <= 0xdfff && index >= 2) {
    const highUnit = text.charCodeAt(index - 2);
    if (highUnit >= 0xd800 && highUnit <= 0xdbff) {
      return text.codePointAt(index - 2);
    }
  }
  return text.codePointAt(index - 1);
}
