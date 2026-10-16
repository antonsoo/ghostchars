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

import { rgiEmojiTagSequences } from '../generated/emoji-tag-sequences.js';

const REGISTERED_FLAGS = rgiEmojiTagSequences.map(sequence => String.fromCodePoint(...sequence));

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
  /** True only for a registered RGI emoji tag sequence in the vendored Unicode data. */
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
 * each is a registered RGI emoji tag sequence or a stray run. Structure alone
 * cannot establish an exemption: BASE + arbitrary instructions + CANCEL has
 * that same shape. A registered prefix is its own run, so trailing payloads
 * can be removed without destroying the legitimate flag.
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
      const registered = prevIsBase ? REGISTERED_FLAGS.find(sequence => text.startsWith(sequence, start)) : undefined;
      const registeredEnd = registered === undefined ? undefined : start + registered.length;
      let j = i;
      const codePoints: number[] = [];
      let decoded = '';
      while (j < text.length) {
        if (registeredEnd !== undefined && j >= registeredEnd) break;
        const c = text.codePointAt(j)!;
        if (c < TAG_BASE || c > TAG_CANCEL) break;
        codePoints.push(c);
        decoded += tagCharToAscii(c);
        j += c > 0xffff ? 2 : 1;
      }
      const isValidEmojiTagSequence = registered !== undefined;
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
