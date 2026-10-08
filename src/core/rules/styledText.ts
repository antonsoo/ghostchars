import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import type { PositionLookup } from './position.js';

// Letters drawn from the styled alphabets: the mathematical bold, italic, script, fraktur and
// double-struck alphabets, fullwidth Latin, the circled and squared letters, and small capitals. Each stands
// for a plain letter -- NFKC folds most of them to it -- and a model reads them as that
// letter, while a keyword match, a lint rule or a deny-list that compares code points does
// not. They are the decoration of a LinkedIn post and the disguise of a jailbreak, and
// nothing in the characters says which. What can be said is what the text reads as.
//
// confusables.txt maps these to ASCII too, so a document that spells a word both ways used
// to be reported as a lookalike attack. A text written wholly in a styled alphabet, with no
// plain spelling to collide with, was not reported at all.

// Small capitals have no compatibility decomposition and most are missing from confusables.txt,
// so they are listed. There is no small capital X, and Q has none in common use.
const SMALL_CAPITALS: ReadonlyMap<number, string> = new Map([
  [0x1d00, 'a'], [0x0299, 'b'], [0x1d04, 'c'], [0x1d05, 'd'], [0x1d07, 'e'], [0xa730, 'f'], [0x0262, 'g'], [0x029c, 'h'],
  [0x026a, 'i'], [0x1d0a, 'j'], [0x1d0b, 'k'], [0x029f, 'l'], [0x1d0d, 'm'], [0x0274, 'n'], [0x1d0f, 'o'], [0x1d18, 'p'],
  [0x0280, 'r'], [0xa731, 's'], [0x1d1b, 't'], [0x1d1c, 'u'], [0x1d20, 'v'], [0x1d21, 'w'], [0x028f, 'y'], [0x1d22, 'z'],
]);

const STYLED_CLASS = '[\\u{1D400}-\\u{1D7FF}\\u{FF10}-\\u{FF19}\\u{FF21}-\\u{FF3A}\\u{FF41}-\\u{FF5A}\\u{24B6}-\\u{24E9}\\u{1F130}-\\u{1F189}' + [...SMALL_CAPITALS.keys()].map((cp) => `\\u{${cp.toString(16)}}`).join('') + ']';
const STYLED_CHAR_RE = new RegExp(STYLED_CLASS, 'u');

/** The plain ASCII letters and digits a styled character stands for, or undefined if it is not one. */
function foldStyled(ch: string): string | undefined {
  const cp = ch.codePointAt(0)!;
  const small = SMALL_CAPITALS.get(cp);
  if (small !== undefined) return small;
  // The negative circled and negative squared letters have no compatibility decomposition.
  if (cp >= 0x1f150 && cp <= 0x1f169) return String.fromCharCode(0x41 + cp - 0x1f150);
  if (cp >= 0x1f170 && cp <= 0x1f189) return String.fromCharCode(0x41 + cp - 0x1f170);
  const folded = ch.normalize('NFKC');
  return /^[A-Za-z0-9]+$/.test(folded) ? folded : undefined;
}
// A passage: styled characters, and the spaces and punctuation between styled words, but no
// plain letter, so a whole styled sentence is one finding and not one per word.
const PASSAGE_RE = new RegExp(`${STYLED_CLASS}+(?:[^\\p{L}\\p{N}]{1,3}${STYLED_CLASS}+)*`, 'gu');
const MIN_STYLED_LETTERS = 3;

/** True for a character of the styled alphabets that folds to a plain letter or digit. */
export function isStyledChar(ch: string): boolean {
  return STYLED_CHAR_RE.test(ch) && foldStyled(ch) !== undefined;
}

// Japanese and Chinese typesetting sets Latin letters and digits at fullwidth width.
function isCjk(cp: number | undefined): boolean {
  return cp !== undefined && ((cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff61 && cp <= 0xffdc));
}

function blockOf(cp: number): string {
  if (cp >= 0x1d400 && cp <= 0x1d7ff) return 'mathematical alphanumeric';
  if (cp >= 0xff00 && cp <= 0xffef) return 'fullwidth';
  if (cp >= 0x24b6 && cp <= 0x24e9) return 'circled';
  if (SMALL_CAPITALS.has(cp)) return 'small capital';
  return 'squared';
}

export function scanStyledText(text: string, positionAt: PositionLookup): Finding[] {
  const findings: Finding[] = [];
  PASSAGE_RE.lastIndex = 0;
  for (let match = PASSAGE_RE.exec(text); match !== null; match = PASSAGE_RE.exec(text)) {
    const passage = match[0];
    const codePoints: number[] = [];
    let folded = '';
    let letters = 0;
    let fullwidthOnly = true;
    const blocks = new Set<string>();
    for (const ch of passage) {
      const cp = ch.codePointAt(0)!;
      codePoints.push(cp);
      const plain = STYLED_CHAR_RE.test(ch) ? foldStyled(ch) : undefined;
      if (plain === undefined) {
        folded += ch;
        continue;
      }
      folded += plain;
      blocks.add(blockOf(cp));
      if (/[A-Za-z]/.test(plain)) letters++;
      if (blockOf(cp) !== 'fullwidth') fullwidthOnly = false;
    }
    if (letters < MIN_STYLED_LETTERS) continue;
    const end = match.index + passage.length;
    if (fullwidthOnly && (isCjk(text.codePointAt(match.index - 1)) || isCjk(text.codePointAt(end)))) continue;
    findings.push({
      rule: 'styled-text',
      severity: 'warning',
      start: positionAt(match.index),
      end: positionAt(end),
      codePoints,
      names: [unicodeName(codePoints[0]!)],
      message: `${letters} letters in ${[...blocks].join(' and ')} styled alphabets read as ${JSON.stringify(folded.length > 160 ? folded.slice(0, 160) + '...' : folded)} once normalised to plain letters (NFKC). A model reads that text; a filter that compares code points without normalising does not.`,
      suggestion: 'Normalise with NFKC before matching the text against anything, or replace the passage with plain letters if the styling is not wanted.',
      decoded: folded,
      fixable: false,
    });
  }
  return findings;
}
