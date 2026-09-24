// Unicode names for the specific code points ghostchars reasons about.
//
// This is a curated table, not a full copy of UnicodeData.txt: every rule in
// this project targets a small, enumerable set of control/format characters
// (bidi controls, invisibles, tag characters, variation selectors, unusual
// whitespace) whose names are part of the stable Unicode character name
// contract (https://www.unicode.org/policies/stability_policy.html#Name).
// Confusable base letters fall back to a generic "U+XXXX" label, since those
// span essentially the whole letter repertoire.

const NAMES: ReadonlyMap<number, string> = new Map([
  // Bidi formatting controls
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  [0x061c, 'ARABIC LETTER MARK'],

  // Invisible / zero-width / default-ignorable characters
  [0x00ad, 'SOFT HYPHEN'],
  [0x034f, 'COMBINING GRAPHEME JOINER'],
  [0x115f, 'HANGUL CHOSEONG FILLER'],
  [0x1160, 'HANGUL JUNGSEONG FILLER'],
  [0x180e, 'MONGOLIAN VOWEL SEPARATOR'],
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x2060, 'WORD JOINER'],
  [0x2061, 'FUNCTION APPLICATION'],
  [0x2062, 'INVISIBLE TIMES'],
  [0x2063, 'INVISIBLE SEPARATOR'],
  [0x2064, 'INVISIBLE PLUS'],
  [0x3164, 'HANGUL FILLER'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE'],
  [0xffa0, 'HALFWIDTH HANGUL FILLER'],

  // Unusual whitespace
  [0x00a0, 'NO-BREAK SPACE'],
  [0x2000, 'EN QUAD'],
  [0x2001, 'EM QUAD'],
  [0x2002, 'EN SPACE'],
  [0x2003, 'EM SPACE'],
  [0x2004, 'THREE-PER-EM SPACE'],
  [0x2005, 'FOUR-PER-EM SPACE'],
  [0x2006, 'SIX-PER-EM SPACE'],
  [0x2007, 'FIGURE SPACE'],
  [0x2008, 'PUNCTUATION SPACE'],
  [0x2009, 'THIN SPACE'],
  [0x200a, 'HAIR SPACE'],
  [0x2028, 'LINE SEPARATOR'],
  [0x2029, 'PARAGRAPH SEPARATOR'],
  [0x202f, 'NARROW NO-BREAK SPACE'],
  [0x205f, 'MEDIUM MATHEMATICAL SPACE'],
  [0x3000, 'IDEOGRAPHIC SPACE'],
  [0x0085, 'NEXT LINE (NEL)'],

  // Notable C0/C1 controls
  [0x0000, 'NULL'],
  [0x0007, 'BELL'],
  [0x0008, 'BACKSPACE'],
  [0x001b, 'ESCAPE'],
  [0x007f, 'DELETE'],
]);

export function unicodeName(cp: number): string {
  const known = NAMES.get(cp);
  if (known) return known;
  if (cp === 0x1f3f4) return 'WAVING BLACK FLAG';
  if (cp >= 0xe0000 && cp <= 0xe007f) {
    if (cp === 0xe0001) return 'LANGUAGE TAG';
    if (cp === 0xe007f) return 'CANCEL TAG';
    if (cp >= 0xe0020 && cp <= 0xe007e) return `TAG ${String.fromCharCode(cp - 0xe0000)}`;
    return `TAG CHARACTER U+${cp.toString(16).toUpperCase()}`;
  }
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `VARIATION SELECTOR-${cp - 0xfe00 + 1}`;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return `VARIATION SELECTOR-${cp - 0xe0100 + 17}`;
  if (cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) return `CONTROL CHARACTER U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  if (cp >= 0x80 && cp <= 0x9f) return `CONTROL CHARACTER U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}
