import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import { isDefaultIgnorable, isEmoji, isRegionalIndicator, scriptsOf } from '../unicode-utils.js';
import type { CodePointInfo } from '../unicode-utils.js';
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

export function scanInvisible(codePoints: CodePointInfo[]): Finding[] {
  const findings: Finding[] = [];

  for (let idx = 0; idx < codePoints.length; idx++) {
    const cp = codePoints[idx];
    if (!cp) continue;
    if (!isDefaultIgnorable(cp.codePoint) || isOwnedElsewhere(cp.codePoint)) continue;

    if (cp.codePoint === BOM && cp.index === 0) continue; // BOM at file start is a legitimate encoding signature

    if (cp.codePoint === ZWJ || cp.codePoint === ZWNJ) {
      const prev = codePoints[idx - 1];
      const next = codePoints[idx + 1];
      if (cp.codePoint === ZWJ && isEmojiJoinContext(prev, next)) continue;
      if (isJoiningScriptContext(prev, next)) continue;
    }

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

function isEmojiJoinContext(prev: CodePointInfo | undefined, next: CodePointInfo | undefined): boolean {
  const isEmojiLike = (c: CodePointInfo | undefined) => c !== undefined && (isEmoji(c.codePoint) || isRegionalIndicator(c.codePoint) || c.codePoint === 0xfe0f);
  return isEmojiLike(prev) && isEmojiLike(next);
}

function isJoiningScriptContext(prev: CodePointInfo | undefined, next: CodePointInfo | undefined): boolean {
  const inJoiningScript = (c: CodePointInfo | undefined) => c !== undefined && scriptsOf(c.codePoint).some((s) => JOINING_SCRIPTS.has(s));
  return inJoiningScript(prev) && inJoiningScript(next);
}
