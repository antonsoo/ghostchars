import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanText } from '../src/core/scanText.js';
import { sanitize } from '../src/core/sanitize.js';

interface OracleCase {
  name: string;
  left: string;
  right: string;
  leftSkeleton: string;
  expectedCollisions: number;
}
const oracle = JSON.parse(readFileSync(new URL('../studies/canonical-confusables/oracle.json', import.meta.url), 'utf8')) as { cases: OracleCase[] };

describe('canonical confusables against independently captured ICU skeletons', () => {
  it('keeps both canonical variants when a canonically distinct lookalike is also present', () => {
    const words = ['cop\u00e9', 'cope\u0301', '\u0441\u043e\u0440\u0435\u0301'];
    const text = words.join(' ');
    const findings = scanText(text).findings.filter(f => f.rule === 'confusable' && f.severity === 'error');
    expect(findings.map(f => text.slice(f.start.offset, f.end.offset))).toEqual(words);
    expect(findings.map(f => f.skeleton)).toEqual(['cope\u0301', 'cope\u0301', 'cope\u0301']);
  });

  it.each(oracle.cases)('$name', ({ left, right, leftSkeleton, expectedCollisions }) => {
    const text = `${left} ${right}`;
    const collisions = scanText(text).findings.filter(f => f.rule === 'confusable' && f.severity === 'error');
    expect(collisions).toHaveLength(expectedCollisions);
    for (const finding of collisions) {
      expect(finding.skeleton).toBe(leftSkeleton);
      expect(finding.fixable).toBe(false);
      const original = text.slice(finding.start.offset, finding.end.offset);
      expect([left, right]).toContain(original);
      expect(finding.codePoints).toEqual([...original].map(c => c.codePointAt(0)));
    }
    // Normalization is an analysis operation. Renaming either identifier can change a program.
    expect(sanitize(text).text).toBe(text);
  });

  it.each(['\n', '\r\n', '\r'])('locates original code units across %j line breaks', newline => {
    const left = 'cop\u00e9', right = '\u0441\u043e\u0440\u0435\u0301';
    const text = `// \u{1f408}${newline}const ${left} = 1;${newline}const ${right} = 2;`;
    const collisions = scanText(text).findings.filter(f => f.rule === 'confusable' && f.severity === 'error');
    expect(collisions).toHaveLength(2);
    for (const [index, spelling] of [left, right].entries()) {
      const start = text.indexOf(spelling);
      expect(collisions[index]!.start).toEqual({ line: index + 2, column: 7, offset: start });
      expect(collisions[index]!.end).toEqual({ line: index + 2, column: 7 + spelling.length, offset: start + spelling.length });
    }
  });
});
