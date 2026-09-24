import { unicodeName } from '../names.js';
import type { Finding } from '../types.js';
import type { CodePointInfo } from '../unicode-utils.js';

// Unusual whitespace: visually indistinguishable (or nearly so) from a
// normal space/newline but tokenizes differently, which has been used to
// break out of string literals, defeat naive keyword filters, and confuse
// diff/review tooling. NBSP, the Zs space-separator block U+2000-200A and
// U+3000 (ideographic space), plus U+202F/U+205F (also General_Category=Zs,
// included alongside the brief's list for completeness) and the two
// non-ASCII line/paragraph separators U+2028/U+2029 and NEL U+0085.
const UNUSUAL_WHITESPACE = new Set([0x00a0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x2028, 0x2029, 0x3000, 0x0085]);

const ESCAPE = 0x001b;

function isC0Control(cp: number): boolean {
  return cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d;
}

function isC1Control(cp: number): boolean {
  return cp >= 0x80 && cp <= 0x9f;
}

export function scanWhitespaceAndControl(codePoints: CodePointInfo[]): Finding[] {
  const findings: Finding[] = [];
  for (const cp of codePoints) {
    if (UNUSUAL_WHITESPACE.has(cp.codePoint)) {
      findings.push(finding(cp, 'unusual-whitespace', 'warning', `${unicodeName(cp.codePoint)} looks like a normal space or line break but is a distinct code point -- it can split tokens, defeat string/keyword matching, or hide in a diff.`, 'Replace with a regular space (U+0020) or ASCII newline.'));
    } else if (isC0Control(cp.codePoint) || isC1Control(cp.codePoint)) {
      const isEscape = cp.codePoint === ESCAPE;
      findings.push(
        finding(
          cp,
          'control-character',
          isEscape ? 'error' : 'warning',
          isEscape
            ? 'ESCAPE (U+001B) begins a terminal control sequence -- printed to a terminal, this can rewrite the prompt, hide text, or (on vulnerable terminals) inject keystrokes.'
            : `${unicodeName(cp.codePoint)} is a non-printing control character with no place in normal text.`,
          'Remove this character.',
        ),
      );
    }
  }
  return findings;
}

function finding(cp: CodePointInfo, rule: Finding['rule'], severity: Finding['severity'], message: string, suggestion: string): Finding {
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
