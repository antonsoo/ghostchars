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
//   1. A single word whose scripts go beyond what UTS #39's restriction
//      levels allow (section 5.2): see `allowedScriptMix` below.
//   2. Two distinct words *elsewhere in the same input* that reduce to the
//      same skeleton and are not simply two words of one script -- the
//      actual lookalike attack.

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

/** For each character of a word that belongs to a script at all, the scripts it can be read as
 * (its Script, or any of its Script_Extensions). Common and Inherited characters say nothing. */
function scriptSetsOfToken(token: string): string[][] {
  if (ASCII_RE.test(token)) return []; // ASCII letters/digits are always Latin/Common alone -- never "mixed"
  const sets: string[][] = [];
  for (const ch of token) {
    const scripts = scriptsOf(ch.codePointAt(0)!).filter((s) => !SCRIPT_NEUTRAL.has(s));
    if (scripts.length > 0) sets.push(scripts);
  }
  return sets;
}

// UTS #39 section 5.2 ranks a string by how its scripts mix. Two of its levels describe
// ordinary writing, and a word within them is not a finding:
//
//   Highly Restrictive: one script, or Latin with Han + Hiragana + Katakana (Japanese), with
//   Han + Bopomofo (Chinese) or with Han + Hangul (Korean). Text in these languages has no
//   spaces, so a Latin term sits inside the word around it: "JavaScript" followed directly by
//   the katakana for "algorithm" is one word here, and so is a Korean particle attached to
//   "README". A run of sixty real translated READMEs and book lists had 242 such words.
//
//   Moderately Restrictive: Latin with one other Recommended script, except Cyrillic and
//   Greek. Arabic and Hebrew attach prefixes to a Latin term the same way.
//
// What is left is what the rule is for: Latin with Cyrillic or Greek, whose letters pass for
// Latin ones; two non-Latin scripts outside the East Asian sets; and Latin with a script
// that is not in general modern use (Cherokee, Coptic, Deseret, ...). Such a word is then
// reported when it holds a lookalike (see `holdsLookalike`).
const EAST_ASIAN_SETS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['Latin', 'Han', 'Hiragana', 'Katakana']),
  new Set(['Latin', 'Han', 'Bopomofo']),
  new Set(['Latin', 'Han', 'Hangul']),
];

/** UAX #31 Table 5, "Recommended Scripts". */
const RECOMMENDED_SCRIPTS: ReadonlySet<string> = new Set([
  'Arabic', 'Armenian', 'Bengali', 'Bopomofo', 'Cyrillic', 'Devanagari', 'Ethiopic', 'Georgian', 'Greek', 'Gujarati',
  'Gurmukhi', 'Hangul', 'Han', 'Hebrew', 'Hiragana', 'Kannada', 'Katakana', 'Khmer', 'Lao', 'Latin', 'Malayalam',
  'Myanmar', 'Oriya', 'Sinhala', 'Tamil', 'Telugu', 'Thaana', 'Thai', 'Tibetan',
]);
const LATIN_LOOKALIKE_SCRIPTS: ReadonlySet<string> = new Set(['Cyrillic', 'Greek']);

function allowedScriptMix(sets: string[][]): boolean {
  if (sets.length === 0) return true;
  // Nearly every word: all of its characters in the same one script.
  const first = sets[0]!;
  if (first.length === 1 && sets.every((scripts) => scripts.length === 1 && scripts[0] === first[0])) return true;
  // Every character can be read as one of `allowed`.
  const covers = (allowed: ReadonlySet<string>): boolean => sets.every((scripts) => scripts.some((s) => allowed.has(s)));
  const candidates = new Set(sets.flat());
  for (const script of candidates) if (covers(new Set([script]))) return true; // a single script
  if (EAST_ASIAN_SETS.some(covers)) return true;
  for (const script of candidates) {
    if (script === 'Latin' || !RECOMMENDED_SCRIPTS.has(script) || LATIN_LOOKALIKE_SCRIPTS.has(script)) continue;
    if (covers(new Set(['Latin', script]))) return true;
  }
  return false;
}

function isAsciiAlnum(cp: number): boolean {
  return (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

/** True for a non-ASCII character that confusables.txt reduces to ASCII letters and digits:
 * one that passes for Latin (Cyrillic "a", Greek omicron), unlike pi, lambda or a Greek epsilon. */
function passesForAscii(cp: number): boolean {
  if (cp < 128) return false;
  const mapped = getConfusableMap().get(cp);
  return mapped !== undefined && mapped.every(isAsciiAlnum);
}

/** For each ASCII letter or digit, the scripts that have a character passing for it. */
let asciiImitators: Map<number, Set<string>> | undefined;
function scriptsImitating(ascii: number): ReadonlySet<string> {
  if (!asciiImitators) {
    asciiImitators = new Map();
    for (const [source, target] of getConfusableMap()) {
      if (source < 128 || target.length !== 1 || !isAsciiAlnum(target[0]!)) continue;
      let scripts = asciiImitators.get(target[0]!);
      if (!scripts) asciiImitators.set(target[0]!, (scripts = new Set()));
      for (const script of scriptsOf(source)) if (!SCRIPT_NEUTRAL.has(script)) scripts.add(script);
    }
  }
  return asciiImitators.get(ascii) ?? new Set();
}

/**
 * Whether a word whose scripts mix beyond the allowed levels holds an actual lookalike. A Greek
 * letter used as a symbol next to Latin ("LaTeX2" + epsilon, pi, a "delta t" variable in
 * scientific code) mixes Latin and Greek and imitates nothing; what the rule is after is a
 * letter that passes for one of the other script:
 *   - a non-Latin character that reduces to ASCII (Cyrillic "a" in "paypal"), or
 *   - in a word that is mostly another script, an ASCII letter which that script has a
 *     double for (a Latin "c" opening a Russian word).
 */
function holdsLookalike(word: string, sets: string[][]): boolean {
  let ascii = 0;
  let other = 0;
  for (const ch of word) {
    const cp = ch.codePointAt(0)!;
    if (passesForAscii(cp) && !scriptsOf(cp).includes('Latin')) return true;
    if (cp < 128) ascii += isAsciiAlnum(cp) ? 1 : 0;
    else other++;
  }
  if (ascii >= other) return false;
  // The script most of the word is written in: the one a planted ASCII letter would pass for.
  const perScript = new Map<string, number>();
  for (const scripts of sets) for (const script of scripts) if (script !== 'Latin') perScript.set(script, (perScript.get(script) ?? 0) + 1);
  const main = [...perScript].filter(([, count]) => count * 2 >= other).map(([script]) => script);
  for (const ch of word) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 128 || !isAsciiAlnum(cp)) continue;
    const imitators = scriptsImitating(cp);
    if (main.some((script) => imitators.has(script))) return true;
  }
  return false;
}

// A connector (the underscore of snake_case, or of a URL slug) joins words; each is judged on
// its own, so a Russian phrase with "Linux" in it is not one mixed-script word.
const CONNECTOR_RE = /\p{Pc}+/u;

/** True when some word of the token mixes scripts beyond the allowed levels and holds a lookalike. */
function isSuspiciousMix(token: string): boolean {
  if (ASCII_RE.test(token)) return false;
  const words = CONNECTOR_RE.test(token) ? token.split(CONNECTOR_RE) : [token];
  for (const word of words) {
    const sets = scriptSetsOfToken(word);
    if (!allowedScriptMix(sets) && holdsLookalike(word, sets)) return true;
  }
  return false;
}

/** The scripts a word is written in, for comparing two spellings: "Latin" for an ASCII word. */
function scriptSignature(token: string): string {
  if (ASCII_RE.test(token)) return 'Latin';
  return [...new Set(scriptSetsOfToken(token).flat())].sort().join('+') || 'Latin';
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
    if (isSuspiciousMix(token.text)) {
      const scripts = new Set(scriptSetsOfToken(token.text).flat());
      findings.push({
        rule: 'confusable',
        severity: 'warning',
        ...span(token),
        codePoints: [...token.text].map((c) => c.codePointAt(0)!),
        names: [...token.text].map((c) => unicodeName(c.codePointAt(0)!)),
        message: `"${token.text}" mixes scripts (${[...scripts].join(', ')}) in one word -- a common homoglyph-attack shape. Skeleton: "${skeleton}".`,
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
    // Two words of one script that share a skeleton are two words: confusables.txt folds
    // lookalikes inside a script too (Hebrew vav and final nun both reduce to "l"), so ordinary
    // text collides with itself. Latin is kept, since its non-ASCII lookalikes (a dotless i, a
    // fullwidth letter) are how an ASCII name is imitated without leaving the script.
    const signatures = new Set([...distinctSpellings].map(scriptSignature));
    if (signatures.size === 1 && !signatures.has('Latin') && ![...signatures][0]!.includes('+')) continue;

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
