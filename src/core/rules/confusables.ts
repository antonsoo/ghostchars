import { confusablesTable } from '../../generated/confusables.js';
import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import { scriptsOf } from '../unicode-utils.js';

// Follows Unicode UTS #39 (Unicode Security Mechanisms) "skeleton" approach:
// map every code point in an identifier through confusables.txt's prototype
// mapping, concatenate the results, and compare. Two spellings that are not
// character-for-character identical but reduce to the same skeleton are the
// definition of a confusable pair (e.g. an all-Latin "paypal" vs the same
// word with its "a" swapped for Cyrillic small letter a, U+0430 -- written
// as an escape here rather than pasted in literally, for the same reason
// IDENTIFIER_RE below uses escapes: ghostchars would otherwise flag its own
// source). We flag two independent signals, both from TR39 +
// Scripts.txt/ScriptExtensions.txt:
//   1. A single identifier that mixes scripts with no shared "Common"/
//      "Inherited" characters tying them together (restriction-level style
//      check, simplified).
//   2. Two distinct identifiers *elsewhere in the same input* that reduce to
//      the same skeleton -- the actual lookalike attack.

let confusableMap: Map<number, number[]> | undefined;
function getConfusableMap(): Map<number, number[]> {
  if (!confusableMap) confusableMap = new Map(confusablesTable.map(([src, target]) => [src, [...target]]));
  return confusableMap;
}

// ZWNJ/ZWJ (U+200C, U+200D) are built via String.fromCodePoint rather than
// written into this source at all, in any form -- this file is exactly the
// kind of place ghostchars itself would flag an invisible character sitting
// unescaped (or even escaped-but-visually-absent) in source.
const ZWNJ = String.fromCodePoint(0x200c);
const ZWJ = String.fromCodePoint(0x200d);
const IDENTIFIER_RE = new RegExp(`[\\p{L}\\p{M}\\p{Nd}\\p{Pc}][\\p{L}\\p{M}\\p{Nd}\\p{Pc}${ZWNJ}${ZWJ}]*`, 'gu');
const SCRIPT_NEUTRAL = new Set(['Common', 'Inherited']);

// Fast paths for the overwhelmingly common case (a plain ASCII identifier):
// skip the confusables map and script lookups entirely rather than doing a
// map/binary-search per character. Only 8 ASCII code points appear as
// *source* entries in confusables.txt at all (0, 1, I, l-look-alikes, etc.),
// and plain ASCII text can never itself "mix scripts" once Common/Inherited
// (digits, underscore) are excluded -- it is always exactly {Latin} or {}.
// eslint-disable-next-line no-control-regex -- \x00-\x7f is "the ASCII range", not a control-character mistake.
const ASCII_RE = /^[\x00-\x7f]+$/;
const ASCII_CONFUSABLE_CHARS = new Set([...getConfusableMap().keys()].filter((cp) => cp < 128).map((cp) => String.fromCodePoint(cp)));

function skeletonOf(token: string): string {
  if (ASCII_RE.test(token) && ![...token].some((c) => ASCII_CONFUSABLE_CHARS.has(c))) return token;
  const map = getConfusableMap();
  let out = '';
  for (const ch of token) {
    const cp = ch.codePointAt(0)!;
    const mapped = map.get(cp);
    out += mapped ? String.fromCodePoint(...mapped) : ch;
  }
  return out;
}

function scriptsOfToken(token: string): Set<string> {
  if (ASCII_RE.test(token)) return new Set(); // ASCII letters/digits are always Latin/Common alone -- never "mixed"
  const scripts = new Set<string>();
  for (const ch of token) {
    const cp = ch.codePointAt(0)!;
    for (const s of scriptsOf(cp)) {
      if (!SCRIPT_NEUTRAL.has(s)) scripts.add(s);
    }
  }
  return scripts;
}

// UTS #39's Highly Restrictive identifier profile explicitly permits these
// script combinations as a single cohesive unit, because ordinary Japanese,
// Chinese and Korean text legitimately mixes them within one word -- Han
// ideographs alongside Hiragana/Katakana (Japanese), Han alongside Bopomofo
// (Chinese), or Han alongside Hangul (Korean/Hanja). Without this, every
// Japanese localization string in the wild (e.g. a typical `ja`
// diagnostics/messages file) reads as a "mixed-script homoglyph attack",
// which is real noise, not a real signal.
const COHESIVE_SCRIPT_GROUPS: ReadonlyArray<ReadonlySet<string>> = [new Set(['Han', 'Hiragana', 'Katakana']), new Set(['Han', 'Bopomofo']), new Set(['Han', 'Hangul'])];

function isCohesiveScriptSet(scripts: Set<string>): boolean {
  if (scripts.size <= 1) return true;
  return COHESIVE_SCRIPT_GROUPS.some((group) => [...scripts].every((s) => group.has(s)));
}

interface Token {
  text: string;
  index: number;
}

/** Calls `visit` with each identifier-shaped run in `text`, in order. */
function forEachToken(text: string, visit: (token: Token) => void): void {
  IDENTIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENTIFIER_RE.exec(text))) {
    visit({ text: match[0], index: match.index });
    if (match.index === IDENTIFIER_RE.lastIndex) IDENTIFIER_RE.lastIndex++;
  }
}

/** 1-based line and column of a UTF-16 offset, counting "\n" as the line break. Found on first use. */
function lineLookup(text: string): (index: number) => { line: number; column: number } {
  let newlines: number[] | undefined;
  return (index) => {
    if (!newlines) {
      newlines = [];
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0x0a) newlines.push(i);
    }
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (newlines[mid]! < index) lo = mid + 1;
      else hi = mid;
    }
    return { line: lo + 1, column: index - (lo === 0 ? 0 : newlines[lo - 1]! + 1) + 1 };
  };
}

// A pure-ASCII lookalike (rn/m, O/0, l/1/I) is a font-rendering problem, not
// the Unicode cross-script attack this tool targets, and treating it as one
// is noisy: English prose is full of accidental ASCII near-matches (this
// README included, once: "CI" vs "C0/C1"). A collision is only reported
// when at least one of the colliding spellings contains a character outside
// the ASCII range; skeletonOf() still runs for every token regardless (an
// ASCII token can itself contain one of the 8 ASCII confusables.txt source
// characters -- e.g. "admin" skeleton-normalizes its "m" to "rn" -- so its
// skeleton is not always its own text, and both sides of a real, in-scope
// collision have to land on the same key to be found at all).
function isAscii(s: string): boolean {
  return ASCII_RE.test(s);
}

export function scanConfusables(text: string): Finding[] {
  const findings: Finding[] = [];
  const lineOf = lineLookup(text);
  const span = (token: Token): Pick<Finding, 'start' | 'end'> => {
    const { line, column } = lineOf(token.index);
    return {
      start: { line, column, offset: token.index },
      end: { line, column: column + token.text.length, offset: token.index + token.text.length },
    };
  };

  // First the identifiers that contain a non-ASCII character. Only they can mix scripts, and a
  // collision is reported only when one of its spellings is among them (see the note above), so
  // their skeletons are the only ones worth keeping. A file with none is done after this pass,
  // without a skeleton computed or a token kept for any of its ordinary identifiers.
  const bySkeleton = new Map<string, Token[]>();
  forEachToken(text, (token) => {
    if (token.text.length < 2 || isAscii(token.text)) return; // single characters can't "mix" scripts meaningfully
    const skeleton = skeletonOf(token.text);
    const scripts = scriptsOfToken(token.text);
    if (scripts.size > 1 && !isCohesiveScriptSet(scripts)) {
      findings.push({
        rule: 'confusable',
        severity: 'warning',
        ...span(token),
        codePoints: [...token.text].map((c) => c.codePointAt(0)!),
        names: [...token.text].map((c) => unicodeName(c.codePointAt(0)!)),
        message: `Identifier "${token.text}" mixes scripts (${[...scripts].join(', ')}) in one word -- a common homoglyph-attack shape. Skeleton: "${skeleton}".`,
        suggestion: 'Confirm every character is intentional (e.g. a Greek variable name is fine on its own, but Latin+Cyrillic in one identifier rarely is), or rename to a single script.',
        skeleton,
        fixable: false,
      });
    }

    if (!bySkeleton.has(skeleton)) bySkeleton.set(skeleton, []);
    bySkeleton.get(skeleton)!.push(token);
  });
  if (bySkeleton.size === 0) return findings;

  // Then the ASCII identifiers that share one of those skeletons. Each distinct spelling is
  // reduced once; the ones that match nothing are remembered as such and not kept.
  const matchedSkeleton = new Map<string, string | null>();
  forEachToken(text, (token) => {
    if (token.text.length < 2 || !isAscii(token.text)) return;
    let skeleton = matchedSkeleton.get(token.text);
    if (skeleton === undefined) {
      const reduced = skeletonOf(token.text);
      skeleton = bySkeleton.has(reduced) ? reduced : null;
      matchedSkeleton.set(token.text, skeleton);
    }
    if (skeleton !== null) bySkeleton.get(skeleton)!.push(token);
  });

  // Report groups in the order their first spelling appears in the text, each in text order.
  const groups = [...bySkeleton].map(([skeleton, group]) => ({ skeleton, group: group.sort((a, b) => a.index - b.index) }));
  groups.sort((a, b) => a.group[0]!.index - b.group[0]!.index);

  for (const { skeleton, group } of groups) {
    const distinctSpellings = new Set(group.map((t) => t.text));
    if (distinctSpellings.size < 2) continue;
    if (![...distinctSpellings].some((s) => !isAscii(s))) continue; // ASCII-vs-ASCII: out of scope, see note above

    for (const token of group) {
      const others = distinctSpellings.size - (distinctSpellings.has(token.text) ? 1 : 0);
      findings.push({
        rule: 'confusable',
        severity: 'error',
        ...span(token),
        codePoints: [...token.text].map((c) => c.codePointAt(0)!),
        names: [...token.text].map((c) => unicodeName(c.codePointAt(0)!)),
        message: `"${token.text}" is visually confusable with ${others} other spelling(s) used elsewhere in this file (they share the skeleton "${skeleton}") -- this is how lookalike identifier/variable attacks work.`,
        suggestion: 'Rename one of the colliding identifiers so they are visually distinguishable, or confirm this is intentional (e.g. deliberately testing confusable handling).',
        skeleton,
        fixable: false,
      });
    }
  }

  return findings;
}
