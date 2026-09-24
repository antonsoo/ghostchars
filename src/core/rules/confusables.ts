import { confusablesTable } from '../../generated/confusables.js';
import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import { scriptsOf } from '../unicode-utils.js';

// Follows Unicode UTS #39 (Unicode Security Mechanisms) "skeleton" approach:
// map every code point in an identifier through confusables.txt's prototype
// mapping, concatenate the results, and compare. Two spellings that are not
// character-for-character identical but reduce to the same skeleton are the
// definition of a confusable pair (e.g. Latin "paypal" vs "pаypal" with a
// Cyrillic а, U+0430). We flag two independent signals, both from TR39 +
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

const IDENTIFIER_RE = /[\p{L}\p{M}\p{Nd}\p{Pc}][\p{L}\p{M}\p{Nd}\p{Pc}‌‍]*/gu;
const SCRIPT_NEUTRAL = new Set(['Common', 'Inherited']);

function skeletonOf(token: string): string {
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
  const scripts = new Set<string>();
  for (const ch of token) {
    const cp = ch.codePointAt(0)!;
    for (const s of scriptsOf(cp)) {
      if (!SCRIPT_NEUTRAL.has(s)) scripts.add(s);
    }
  }
  return scripts;
}

interface Token {
  text: string;
  index: number;
  line: number;
  column: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let lineStart = 0;
  IDENTIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  // Track line/column by scanning newlines up to each match (identifiers are
  // typically sparse relative to full text, so this stays cheap in practice).
  const newlineIdx: number[] = [];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0x0a) newlineIdx.push(i);

  while ((match = IDENTIFIER_RE.exec(text))) {
    const index = match.index;
    while (line - 1 < newlineIdx.length && newlineIdx[line - 1]! < index) {
      lineStart = newlineIdx[line - 1]! + 1;
      line++;
    }
    tokens.push({ text: match[0], index, line, column: index - lineStart + 1 });
    if (match.index === IDENTIFIER_RE.lastIndex) IDENTIFIER_RE.lastIndex++;
  }
  return tokens;
}

export function scanConfusables(text: string): Finding[] {
  const findings: Finding[] = [];
  const tokens = tokenize(text);
  const bySkeleton = new Map<string, Token[]>();

  for (const token of tokens) {
    if (token.text.length < 2) continue; // single characters can't "mix" scripts meaningfully
    const scripts = scriptsOfToken(token.text);
    if (scripts.size > 1) {
      const skeleton = skeletonOf(token.text);
      findings.push({
        rule: 'confusable',
        severity: 'warning',
        start: { line: token.line, column: token.column, offset: token.index },
        end: { line: token.line, column: token.column + token.text.length, offset: token.index + token.text.length },
        codePoints: [...token.text].map((c) => c.codePointAt(0)!),
        names: [...scripts],
        message: `Identifier "${token.text}" mixes scripts (${[...scripts].join(', ')}) in one word -- a common homoglyph-attack shape. Skeleton: "${skeleton}".`,
        suggestion: 'Confirm every character is intentional (e.g. a Greek variable name is fine on its own, but Latin+Cyrillic in one identifier rarely is), or rename to a single script.',
        skeleton,
        fixable: false,
      });
    }

    const skeleton = skeletonOf(token.text);
    if (!bySkeleton.has(skeleton)) bySkeleton.set(skeleton, []);
    bySkeleton.get(skeleton)!.push(token);
  }

  for (const [skeleton, group] of bySkeleton) {
    const distinctSpellings = new Set(group.map((t) => t.text));
    if (distinctSpellings.size < 2) continue;
    for (const token of group) {
      const others = distinctSpellings.size - (distinctSpellings.has(token.text) ? 1 : 0);
      findings.push({
        rule: 'confusable',
        severity: 'error',
        start: { line: token.line, column: token.column, offset: token.index },
        end: { line: token.line, column: token.column + token.text.length, offset: token.index + token.text.length },
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
