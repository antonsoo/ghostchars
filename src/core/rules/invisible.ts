import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import { defaultIgnorableRanges } from '../../generated/default-ignorable.js';
import { codePointBefore, isEmoji, isRegionalIndicator, rangesToClass, scriptsOf } from '../unicode-utils.js';
import { describeCodePoint, type PositionLookup } from './position.js';
import { BIDI_MARKS, EXPLICIT_FORMATTING } from './bidi.js';
import { TAG_BASE, TAG_CANCEL } from '../decodeTags.js';
import { isVariationSelector } from '../decodeVariationSelectors.js';

// Detection is driven by the Unicode Default_Ignorable_Code_Point property
// (src/generated/default-ignorable.ts, from DerivedCoreProperties.txt)
// rather than a hand-maintained list: anything the standard itself says
// should render as nothing is worth surfacing, because "renders as nothing"
// is exactly the property an attacker hiding text wants.
//
// Ranges already owned by a more specific rule (bidi controls/marks, tag
// characters, variation selectors) are excluded here to avoid double
// reporting; everything else default-ignorable is flagged unless it matches
// one of the two legitimate contexts below.

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const BOM = 0xfeff;

// Scripts where ZWNJ/ZWJ are part of normal orthography (joining Arabic-
// family scripts, and Indic scripts that use ZWJ/ZWNJ to control conjunct
// formation).
const JOINING_SCRIPTS = new Set([
  'Arabic',
  'Syriac',
  'Nko',
  'Mandaic',
  'Manichaean',
  'Psalter_Pahlavi',
  'Sogdian',
  'Old_Uyghur',
  'Hanifi_Rohingya',
  'Adlam',
  'Hebrew',
  'Devanagari',
  'Bengali',
  'Gurmukhi',
  'Gujarati',
  'Oriya',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Sinhala',
  'Tibetan',
  'Myanmar',
  'Khmer',
  'Javanese',
  'Balinese',
  'Limbu',
  'Buginese',
]);

// Viramas (halants) of the Indic and Southeast Asian scripts above. A ZWJ/ZWNJ right after one
// selects a half form, a chillu or an explicit virama (Unicode ch. 12, "Rendering Behavior"),
// including at the end of a word -- legacy Malayalam chillus are NA + VIRAMA + ZWJ -- so the
// character after it needn't be in the script at all.
const VIRAMAS = new Set([
  0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d4d, 0x0dca, 0x0f84, 0x1039, 0x103a, 0x17d2, 0x1b44, 0xa9c0,
]);

function isOwnedElsewhere(cp: number): boolean {
  return (
    EXPLICIT_FORMATTING.has(cp) ||
    BIDI_MARKS.has(cp) ||
    (cp >= TAG_BASE && cp <= TAG_CANCEL) ||
    isVariationSelector(cp) ||
    (cp >= 0x180b && cp <= 0x180d) || // Mongolian free variation selectors: legitimate script marks
    (cp >= 0x17b4 && cp <= 0x17b5) // Khmer inherent vowels: legitimate script marks
  );
}

// Default_Ignorable_Code_Point, as one expression: the scan visits these characters and
// nothing else, instead of holding every code point of the text in memory to find them.
const DEFAULT_IGNORABLE_RE = new RegExp(rangesToClass(defaultIgnorableRanges), 'gu');

export function scanInvisible(text: string, positionAt: PositionLookup): Finding[] {
  const findings: Finding[] = [];

  DEFAULT_IGNORABLE_RE.lastIndex = 0;
  for (let match = DEFAULT_IGNORABLE_RE.exec(text); match !== null; match = DEFAULT_IGNORABLE_RE.exec(text)) {
    const index = match.index;
    const codePoint = text.codePointAt(index)!;
    if (isOwnedElsewhere(codePoint)) continue;

    if (codePoint === BOM && index === 0) continue; // BOM at file start is a legitimate encoding signature

    if (codePoint === ZWJ || codePoint === ZWNJ) {
      const prev = codePointBefore(text, index);
      const next = text.codePointAt(index + 1);
      if (codePoint === ZWJ && isEmojiJoinContext(prev, next)) continue;
      if (isJoiningScriptContext(prev, next)) continue;
      if (prev !== undefined && VIRAMAS.has(prev)) continue;
    }

    const cp = describeCodePoint(text, index, positionAt);
    findings.push({
      rule: 'invisible',
      severity: 'warning',
      start: { line: cp.line, column: cp.column, offset: cp.index },
      end: { line: cp.line, column: cp.column + cp.width, offset: cp.index + cp.width },
      codePoints: [cp.codePoint],
      names: [unicodeName(cp.codePoint)],
      message: `${unicodeName(cp.codePoint)} (U+${cp.codePoint.toString(16).toUpperCase().padStart(4, '0')}) is invisible and can hide or split identifiers/words without any visible trace.`,
      suggestion: 'Remove this character unless it is a documented, intentional zero-width joiner/non-joiner for the surrounding script or emoji sequence.',
      fixable: true,
    });
  }

  return findings;
}

function isEmojiJoinContext(prev: number | undefined, next: number | undefined): boolean {
  const isEmojiLike = (c: number | undefined) => c !== undefined && (isEmoji(c) || isRegionalIndicator(c) || c === 0xfe0f);
  return isEmojiLike(prev) && isEmojiLike(next);
}

function isJoiningScriptContext(prev: number | undefined, next: number | undefined): boolean {
  const inJoiningScript = (c: number | undefined) => c !== undefined && scriptsOf(c).some((s) => JOINING_SCRIPTS.has(s));
  return inJoiningScript(prev) && inJoiningScript(next);
}
