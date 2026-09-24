import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import type { CodePointInfo } from '../unicode-utils.js';

// Trojan Source (Boucher & Anderson, "Trojan Source: Invisible Vulnerabilities",
// USENIX Security 2023 / arXiv:2111.00169, first disclosed as CVE-2021-42574)
// showed that bidi control characters can reorder how source *displays*
// without changing how it *compiles*, letting an attacker hide code inside
// what looks like a comment or string.

export const EXPLICIT_FORMATTING = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
export const BIDI_MARKS = new Set([0x200e, 0x200f, 0x061c]);
const MARKS = BIDI_MARKS;

const EMBED_OR_OVERRIDE = new Set([0x202a, 0x202b, 0x202d, 0x202e]); // LRE RLE LRO RLO
const ISOLATE_INITIATOR = new Set([0x2066, 0x2067, 0x2068]); // LRI RLI FSI
const PDF = 0x202c;
const PDI = 0x2069;

interface StackEntry {
  codePoint: number;
  kind: 'embed' | 'isolate';
  info: CodePointInfo;
}

/**
 * Flags every explicit bidi formatting character as an error and every bidi
 * mark as a warning, then separately walks a per-line stack to catch
 * embeddings/isolates that are opened but never closed (or closed with
 * nothing open) -- the shape of a Trojan Source payload.
 *
 * Simplification: the stack resets at each line break. The bidi algorithm
 * technically allows state to persist across a paragraph, but every editor,
 * terminal and diff viewer humans read source through renders each line
 * independently, so an embedding left open at end-of-line is already enough
 * to make that line lie about its own content -- which is the property this
 * tool cares about.
 */
export function scanBidi(codePoints: CodePointInfo[], text: string): Finding[] {
  const findings: Finding[] = [];
  let stack: StackEntry[] = [];

  const flushUnterminated = () => {
    for (const entry of stack) {
      findings.push(makeFinding(entry.info, text, 'bidi-unbalanced', 'error', `${unicodeName(entry.codePoint)} is opened but never closed before the end of the line.`, 'Add the matching POP DIRECTIONAL FORMATTING (U+202C) or POP DIRECTIONAL ISOLATE (U+2069), or remove this character.'));
    }
    stack = [];
  };

  for (const cp of codePoints) {
    if (EXPLICIT_FORMATTING.has(cp.codePoint)) {
      findings.push(
        makeFinding(
          cp,
          text,
          'bidi-control',
          'error',
          `${unicodeName(cp.codePoint)} changes the visual order of surrounding text without changing the underlying code -- the mechanism behind Trojan Source (CVE-2021-42574).`,
          'Remove this character unless the file is deliberately handling bidirectional text, in which case keep embeddings short, always balanced, and never spanning a comment/string boundary.',
        ),
      );
    } else if (MARKS.has(cp.codePoint)) {
      findings.push(makeFinding(cp, text, 'bidi-mark', 'warning', `${unicodeName(cp.codePoint)} is an invisible directional hint that can subtly affect adjacent punctuation layout.`, 'Remove unless intentionally formatting mixed-direction text.'));
    }

    if (EMBED_OR_OVERRIDE.has(cp.codePoint)) {
      stack.push({ codePoint: cp.codePoint, kind: 'embed', info: cp });
    } else if (ISOLATE_INITIATOR.has(cp.codePoint)) {
      stack.push({ codePoint: cp.codePoint, kind: 'isolate', info: cp });
    } else if (cp.codePoint === PDF) {
      const top = stack[stack.length - 1];
      if (top && top.kind === 'embed') {
        stack.pop();
      } else {
        findings.push(makeFinding(cp, text, 'bidi-unbalanced', 'error', 'POP DIRECTIONAL FORMATTING (U+202C) has no matching embedding/override to close on this line.', 'Remove this character or add the missing LRE/RLE/LRO/RLO before it.'));
      }
    } else if (cp.codePoint === PDI) {
      const idx = [...stack].reverse().findIndex((e) => e.kind === 'isolate');
      if (idx === -1) {
        findings.push(makeFinding(cp, text, 'bidi-unbalanced', 'error', 'POP DIRECTIONAL ISOLATE (U+2069) has no matching isolate to close on this line.', 'Remove this character or add the missing LRI/RLI/FSI before it.'));
      } else {
        stack.length = stack.length - 1 - idx;
      }
    } else if (cp.codePoint === 0x0a || cp.codePoint === 0x0d) {
      flushUnterminated();
    }
  }
  flushUnterminated();

  return findings;
}

function makeFinding(cp: CodePointInfo, text: string, rule: Finding['rule'], severity: Finding['severity'], message: string, suggestion: string): Finding {
  return {
    rule,
    severity,
    start: { line: cp.line, column: cp.column, offset: cp.index },
    end: { line: cp.line, column: cp.column + cp.width, offset: cp.index + cp.width },
    codePoints: [cp.codePoint],
    names: [unicodeName(cp.codePoint)],
    message,
    suggestion,
    fixable: true,
  };
}
